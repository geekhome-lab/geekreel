import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { emptyTimelineDoc, sanitizeTitle, type RemakeRun, type RemakeTemplate, type RemakeTemplateDoc } from "@vw/core";
import { getAdapter } from "@vw/models";
import { assembleSubtitleClips, parseRemakeShots, remakePrompt, REMAKE_SYSTEM } from "@vw/remake";
import { db } from "../db";
import type { JobHandler } from "../jobs/queue";
import { newId, now } from "../lib/resp";
import { getReport } from "./analyze";
import { libraryRoot } from "./library";
import { resolveEndpoint } from "./models";
import { chatMetered } from "./usage";

interface TplRow {
  id: string;
  analysisId: string | null;
  name: string;
  slotsJson: string;
  createdAt: number;
}

function rowToTpl(row: TplRow): RemakeTemplate {
  return {
    id: row.id,
    analysisId: row.analysisId,
    name: row.name,
    doc: JSON.parse(row.slotsJson) as RemakeTemplateDoc,
    createdAt: row.createdAt,
  };
}

export function listTemplates(): RemakeTemplate[] {
  return (db.query("SELECT * FROM remake_templates ORDER BY createdAt DESC LIMIT 50").all() as TplRow[]).map(rowToTpl);
}

export function getTemplate(id: string): RemakeTemplate | null {
  const row = db.query("SELECT * FROM remake_templates WHERE id = ?").get(id) as TplRow | null;
  return row ? rowToTpl(row) : null;
}

export function templateFromReport(reportId: string): RemakeTemplate {
  const report = getReport(reportId);
  if (!report) throw new Error("报告不存在");
  const existing = db
    .query("SELECT * FROM remake_templates WHERE analysisId = ? ORDER BY createdAt DESC LIMIT 1")
    .get(reportId) as TplRow | null;
  if (existing) return rowToTpl(existing);
  const id = newId();
  const doc = report.report.template;
  db.run("INSERT INTO remake_templates (id, analysisId, name, slotsJson, createdAt) VALUES (?, ?, ?, ?, ?)", [
    id, reportId, doc.name || report.title, JSON.stringify(doc), now(),
  ]);
  return getTemplate(id)!;
}

function writeRemakeTimeline(
  dir: string,
  shots: Array<{ line: string; imagePrompt: string; maxSec: number; slotId?: string }>,
  align?: {
    originalShots?: Array<{ startMs: number; endMs: number; line: string }>;
    words?: Array<{ word: string; startMs: number; endMs: number }>;
  },
) {
  const clips = assembleSubtitleClips(shots, align);
  const doc = emptyTimelineDoc();
  const sTrack = doc.tracks.find((t) => t.type === "subtitle")!;
  clips.forEach((c, i) => {
    sTrack.clips.push({
      id: `c_s_${i}`,
      text: c.text,
      startMs: c.startMs,
      inMs: 0,
      outMs: c.durationMs,
      volume: 1,
    });
  });
  mkdirSync(join(dir, "timeline"), { recursive: true });
  writeFileSync(join(dir, "timeline", "main.json"), JSON.stringify(doc, null, 2));
}

function createProjectWithShots(
  name: string,
  shots: Array<{ imagePrompt: string; line: string; maxSec: number }>,
  align?: {
    originalShots?: Array<{ startMs: number; endMs: number; line: string }>;
    words?: Array<{ word: string; startMs: number; endMs: number }>;
  },
): { projectId: string; name: string } {
  const id = newId();
  const d = new Date();
  const mmdd = `${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const hash = id.replace(/-/g, "").slice(0, 4);
  const dir = join(libraryRoot(), "projects", `${mmdd}_${sanitizeTitle(name, 24)}_${hash}`);
  mkdirSync(join(dir, "canvas"), { recursive: true });
  mkdirSync(join(dir, "pipeline"), { recursive: true });
  mkdirSync(join(dir, "export"), { recursive: true });
  const t = now();
  writeFileSync(join(dir, "project.vw.json"), JSON.stringify({ id, name, version: 1, source: "remake", createdAt: new Date(t).toISOString() }, null, 2));
  db.run("INSERT INTO projects (id, name, directory, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)", [id, name, dir, t, t]);

  const nodes: unknown[] = [];
  const edges: unknown[] = [];
  shots.forEach((shot, i) => {
    const x = 80 + i * 620;
    nodes.push(
      { id: `text_${i}`, type: "textNode", position: { x, y: 120 }, data: { text: shot.imagePrompt } },
      {
        id: `gen_${i}`,
        type: "imageGenNode",
        position: { x: x + 320, y: 100 },
        data: { prompt: "", size: "1024x1024", endpointId: null, status: "idle" },
      },
    );
    edges.push({ id: `e_${i}`, source: `text_${i}`, sourceHandle: "out", target: `gen_${i}`, targetHandle: "prompt", animated: true });
  });
  const canvasId = newId();
  writeFileSync(join(dir, "canvas/主画布.json"), JSON.stringify({ version: 1, nodes, edges, viewport: null }));
  db.run("INSERT INTO canvas_docs (id, projectId, name, path, updatedAt) VALUES (?, ?, ?, ?, ?)", [
    canvasId, id, "主画布", "canvas/主画布.json", t,
  ]);
  writeRemakeTimeline(dir, shots, align);
  return { projectId: id, name };
}

export const remakeRunHandler: JobHandler = async (job, ctx) => {
  const payload = JSON.parse(job.payloadJson) as {
    templateId?: string;
    reportId?: string;
    variables?: Record<string, string>;
    endpointId?: string;
    variantCount?: number;
  };
  ctx.progress(0.1, "读取模板");
  const tpl = payload.templateId
    ? getTemplate(payload.templateId)
    : payload.reportId
      ? templateFromReport(payload.reportId)
      : null;
  if (!tpl) throw new Error("请先出一份分析报告，再点复刻");

  const variables = payload.variables ?? {};
  const theme = variables["主题"]?.trim() || variables.theme?.trim() || tpl.name;

  ctx.progress(0.25, "按你的主题改写分镜");
  const endpoint = resolveEndpoint("llm", payload.endpointId);
  if (!endpoint) throw new Error("复刻需要文本模型来改台词和画面。到「模型」页添加一个。");
  const adapter = getAdapter(endpoint.adapterType);
  if (!adapter?.chat) throw new Error("这个模型不会聊天，换一个文本模型");

  const variantCount = Math.min(6, Math.max(1, Math.round(payload.variantCount ?? 1)));
  const projects: Array<{ projectId: string; name: string; shotCount: number; runId: string }> = [];
  const report = tpl.analysisId ? getReport(tpl.analysisId) : null;

  for (let i = 0; i < variantCount; i++) {
    ctx.progress(0.25 + (i / variantCount) * 0.7, variantCount > 1 ? `改写变体 ${i + 1}/${variantCount}` : "按你的主题改写分镜");
    const text = await chatMetered(
      adapter,
      endpoint,
      {
        system: REMAKE_SYSTEM,
        prompt: remakePrompt(tpl.doc, variables, { variantIndex: i + 1, variantCount }),
      },
      { jobType: "remake.run" },
    );
    const shots = parseRemakeShots(text, tpl.doc);
    if (shots.length === 0) throw new Error("没有生成分镜");
    const suffix = variantCount > 1 ? `变体${i + 1}` : "";
    const project = createProjectWithShots(sanitizeTitle(`${theme}${suffix}`, 16) || "复刻", shots, {
      originalShots: report?.report.shots,
      words: report?.words,
    });
    const runId = newId();
    db.run(
      "INSERT INTO remake_runs (id, templateId, projectId, variablesJson, status, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
      [runId, tpl.id, project.projectId, JSON.stringify({ ...variables, variant: i + 1 }), "done", now()],
    );
    projects.push({ projectId: project.projectId, name: project.name, shotCount: shots.length, runId });
  }

  const first = projects[0]!;
  ctx.progress(1, variantCount > 1 ? `已开 ${variantCount} 个变体` : "项目已建好");
  return {
    runId: first.runId,
    projectId: first.projectId,
    projectIds: projects.map((p) => p.projectId),
    name: first.name,
    shotCount: first.shotCount,
    variantCount,
  };
};

export function exportTemplateJson(id: string): {
  version: 1;
  kind: "vw-remake-template";
  name: string;
  doc: RemakeTemplateDoc;
  exportedAt: string;
} {
  const tpl = getTemplate(id);
  if (!tpl) throw new Error("模板不存在");
  return {
    version: 1,
    kind: "vw-remake-template",
    name: tpl.name,
    doc: tpl.doc,
    exportedAt: new Date().toISOString(),
  };
}

export function importTemplateJson(raw: unknown): RemakeTemplate {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const doc = (obj.doc ?? obj.template ?? obj) as RemakeTemplateDoc;
  if (!doc || !Array.isArray(doc.slots) || doc.slots.length === 0) {
    throw new Error("这不是一份有效的复刻模板。请导入本工作台导出的 JSON。");
  }
  const name = String(obj.name ?? doc.name ?? "导入模板").trim() || "导入模板";
  const id = newId();
  const normalized: RemakeTemplateDoc = {
    name: String(doc.name ?? name).trim() || name,
    variables: Array.isArray(doc.variables) && doc.variables.length ? doc.variables.map((v) => String(v)) : ["主题", "产品", "人物设定"],
    slots: doc.slots.map((s, i) => ({
      id: String(s.id ?? `s${i}`),
      maxSec: Math.max(1, Number(s.maxSec) || 3),
      shotDesc: String(s.shotDesc ?? ""),
      lineSlot: String(s.lineSlot ?? ""),
    })),
  };
  db.run("INSERT INTO remake_templates (id, analysisId, name, slotsJson, createdAt) VALUES (?, ?, ?, ?, ?)", [
    id, null, name, JSON.stringify(normalized), now(),
  ]);
  return getTemplate(id)!;
}

export function listRuns(): RemakeRun[] {
  const rows = db.query("SELECT * FROM remake_runs ORDER BY createdAt DESC LIMIT 30").all() as Array<{
    id: string;
    templateId: string;
    projectId: string | null;
    variablesJson: string;
    status: string;
    createdAt: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    templateId: r.templateId,
    projectId: r.projectId,
    variables: JSON.parse(r.variablesJson) as Record<string, string>,
    status: r.status,
    createdAt: r.createdAt,
  }));
}
