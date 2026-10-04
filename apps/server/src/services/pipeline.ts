import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sanitizeTitle, type DramaBible, type PipelineRun } from "@vw/core";
import { getAdapter } from "@vw/models";
import { injectImagePrompt } from "@vw/style";
import { novelDramaPrompt, NOVEL_DRAMA_SYSTEM, parseDramaBible, stitchEpisodeFrames } from "@vw/pipeline";
import { db } from "../db";
import type { JobHandler } from "../jobs/queue";
import { newId, now } from "../lib/resp";
import { libraryRoot } from "./library";
import { resolveEndpoint } from "./models";
import { loadPack } from "./styles";

interface PipeRow {
  id: string;
  projectId: string;
  templateId: string;
  packId: string | null;
  status: string;
  currentStep: string;
  stateJson: string;
  createdAt: number;
  updatedAt: number;
}

function rowToRun(row: PipeRow): PipelineRun {
  let bible: DramaBible | null = null;
  try {
    const state = JSON.parse(row.stateJson) as { bible?: DramaBible };
    bible = state.bible ?? null;
  } catch {
    bible = null;
  }
  return {
    id: row.id,
    projectId: row.projectId,
    templateId: row.templateId,
    packId: row.packId,
    status: row.status,
    currentStep: row.currentStep,
    bible,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listPipelines(projectId?: string): PipelineRun[] {
  const rows = projectId
    ? (db.query("SELECT * FROM pipelines WHERE projectId = ? ORDER BY createdAt DESC LIMIT 20").all(projectId) as PipeRow[])
    : (db.query("SELECT * FROM pipelines ORDER BY createdAt DESC LIMIT 30").all() as PipeRow[]);
  return rows.map(rowToRun);
}

export function getPipeline(id: string): PipelineRun | null {
  const row = db.query("SELECT * FROM pipelines WHERE id = ?").get(id) as PipeRow | null;
  return row ? rowToRun(row) : null;
}

function createQuickProject(name: string, packId: string | null): { id: string; directory: string; name: string } {
  const id = newId();
  const d = new Date();
  const mmdd = `${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const hash = id.replace(/-/g, "").slice(0, 4);
  const dir = join(libraryRoot(), "projects", `${mmdd}_${sanitizeTitle(name, 24)}_${hash}`);
  mkdirSync(join(dir, "canvas"), { recursive: true });
  mkdirSync(join(dir, "pipeline"), { recursive: true });
  mkdirSync(join(dir, "export"), { recursive: true });
  const t = now();
  writeFileSync(
    join(dir, "project.vw.json"),
    JSON.stringify({ id, name, version: 1, source: "pipeline", stylePackId: packId, createdAt: new Date(t).toISOString() }, null, 2),
  );
  db.run(
    "INSERT INTO projects (id, name, directory, stylePackId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
    [id, name, dir, packId, t, t],
  );
  return { id, directory: dir, name };
}

function writeCanvas(projectId: string, dir: string, bible: DramaBible, imageEndpointId: string | null) {
  const nodes: unknown[] = [];
  const edges: unknown[] = [];
  bible.episodes.forEach((ep, ei) => {
    nodes.push({
      id: `ep_${ei}`,
      type: "textNode",
      position: { x: 40, y: 40 + ei * 380 },
      data: { text: `第${ep.index}集 ${ep.title}\n${ep.narrator || ep.synopsis}` },
    });
    ep.shots.forEach((shot, si) => {
      const x = 360 + si * 620;
      const y = 20 + ei * 380;
      const textId = `t_${ei}_${si}`;
      const genId = `g_${ei}_${si}`;
      const prompt = [shot.imagePrompt, shot.line && `字幕：${shot.line}`].filter(Boolean).join("。");
      nodes.push(
        { id: textId, type: "textNode", position: { x, y: y + 40 }, data: { text: prompt } },
        {
          id: genId,
          type: "imageGenNode",
          position: { x: x + 300, y },
          data: { prompt: "", size: "1024x1024", endpointId: imageEndpointId, status: "idle" },
        },
      );
      edges.push({ id: `e_${ei}_${si}`, source: textId, sourceHandle: "out", target: genId, targetHandle: "prompt", animated: true });
    });
  });

  const existing = db.query("SELECT id, path FROM canvas_docs WHERE projectId = ? ORDER BY updatedAt DESC LIMIT 1").get(projectId) as
    | { id: string; path: string }
    | null;
  const t = now();
  const rel = existing?.path ?? "canvas/主画布.json";
  writeFileSync(join(dir, rel), JSON.stringify({ version: 1, nodes, edges, viewport: null }));
  if (existing) {
    db.run("UPDATE canvas_docs SET updatedAt = ? WHERE id = ?", [t, existing.id]);
  } else {
    db.run("INSERT INTO canvas_docs (id, projectId, name, path, updatedAt) VALUES (?, ?, ?, ?, ?)", [
      newId(), projectId, "主画布", rel, t,
    ]);
  }
}

export const pipelineRunHandler: JobHandler = async (job, ctx) => {
  const payload = JSON.parse(job.payloadJson) as {
    story?: string;
    packId?: string;
    substyle?: string;
    projectId?: string;
    llmEndpointId?: string;
    imageEndpointId?: string;
  };
  const story = payload.story?.trim();
  if (!story) throw new Error("先写一句故事或贴一段小说");

  const pack = payload.packId ? loadPack(payload.packId) : null;
  if (payload.packId && !pack) throw new Error("没找到这套风格。确认 stylePacks/ 里有对应目录。");
  if (pack && !pack.public.ready) throw new Error(pack.public.unavailableReason || "这套风格还不能用");

  ctx.progress(0.08, "建项目");
  const titleHint = story.replace(/\s+/g, " ").slice(0, 16);
  let projectId = payload.projectId;
  let directory = "";
  if (projectId) {
    const row = db.query("SELECT directory FROM projects WHERE id = ?").get(projectId) as { directory: string } | null;
    if (!row) throw new Error("项目不存在");
    directory = row.directory;
  } else {
    const created = createQuickProject(titleHint, pack?.public.id ?? null);
    projectId = created.id;
    directory = created.directory;
  }

  const runId = newId();
  const t0 = now();
  db.run(
    "INSERT INTO pipelines (id, projectId, templateId, packId, status, currentStep, stateJson, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [runId, projectId, pack ? "style-drama" : "novel-drama", pack?.public.id ?? null, "running", "bible", "{}", t0, t0],
  );

  ctx.progress(0.2, "拆 5 集剧本");
  const endpoint = resolveEndpoint("llm", payload.llmEndpointId);
  if (!endpoint) throw new Error("短剧要文本模型来拆集和色盘。到「模型」页加一个。");
  const adapter = getAdapter(endpoint.adapterType);
  if (!adapter?.chat) throw new Error("这个模型不会聊天，换一个文本模型");

  const packHint = pack
    ? `风格：${pack.public.name}。子风格：${payload.substyle || pack.public.defaultSubstyle || "默认"}。色盘要能平涂，不要写光影。`
    : "通用短剧，画面写清楚主体和动作即可。";
  let bible: DramaBible;
  try {
    const text = await adapter.chat(endpoint.config, {
      system: pack?.bibleSystem || NOVEL_DRAMA_SYSTEM,
      prompt: novelDramaPrompt(story, packHint),
    });
    bible = parseDramaBible(text, story);
  } catch {
    bible = parseDramaBible("", story);
  }

  const substyle = payload.substyle || pack?.public.defaultSubstyle || null;
  bible.packId = pack?.public.id ?? null;
  bible.substyle = substyle;
  bible = stitchEpisodeFrames(bible);

  ctx.progress(0.55, "注入风格和色盘");
  if (pack) {
    let prevLast: string | null = null;
    bible = {
      ...bible,
      episodes: bible.episodes.map((ep) => {
        const shots = ep.shots.map((shot, i) => ({
          ...shot,
          imagePrompt: injectImagePrompt({
            pack,
            raw: shot.imagePrompt || shot.visual,
            palette: bible.palette,
            substyle,
            lastFrame: i === 0 ? prevLast : null,
          }),
        }));
        prevLast = ep.lastFrame || shots.at(-1)?.visual || prevLast;
        return { ...ep, shots };
      }),
      assets: bible.assets.map((a) => ({
        ...a,
        prompt: injectImagePrompt({ pack, raw: a.prompt || a.name, palette: bible.palette, substyle }),
      })),
    };
  }

  mkdirSync(join(directory, "pipeline"), { recursive: true });
  writeFileSync(join(directory, "pipeline/bible.json"), JSON.stringify(bible, null, 2));
  db.run("UPDATE projects SET stylePackId = ?, paletteJson = ?, updatedAt = ? WHERE id = ?", [
    pack?.public.id ?? null,
    JSON.stringify(bible.palette),
    now(),
    projectId,
  ]);

  ctx.progress(0.8, "搭画布");
  writeCanvas(projectId, directory, bible, payload.imageEndpointId ?? null);

  const t1 = now();
  db.run("UPDATE pipelines SET status = ?, currentStep = ?, stateJson = ?, updatedAt = ? WHERE id = ?", [
    "done",
    "canvas",
    JSON.stringify({ bible, story }),
    t1,
    runId,
  ]);
  ctx.progress(1, "5 集初稿已搭好");
  return {
    pipelineId: runId,
    projectId,
    title: bible.title,
    episodeCount: bible.episodes.length,
    shotCount: bible.episodes.reduce((n, e) => n + e.shots.length, 0),
  };
};
