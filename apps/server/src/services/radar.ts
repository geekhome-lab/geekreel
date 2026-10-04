import { sanitizeTitle, type RadarItem, type RadarSettings, type RadarSource, type RadarSub } from "@vw/core";
import { getAdapter } from "@vw/models";
import {
  RADAR_SYSTEM,
  buildFocusTemplate,
  inQuietHours,
  isDue,
  itemHash,
  matchSubscription,
  parseRadarResponse,
  sourceTemplates,
} from "@vw/radar";
import { host, port } from "../config";
import { db, getSetting, setSetting } from "../db";
import type { JobHandler } from "../jobs/queue";
import { newId, now } from "../lib/resp";
import { wsHub } from "../ws";
import { getEndpoint, listEndpoints, resolveEndpoint } from "./models";
import { deliverToIds } from "./push";
import { chatMetered } from "./usage";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { libraryRoot } from "./library";

function publicBase(): string {
  return `http://${host}:${port}`;
}

interface SourceRow {
  id: string;
  name: string;
  kind: string;
  platform: string;
  queryTemplate: string;
  intervalMinutes: number;
  endpointId: string | null;
  enabled: number;
  lastRunAt: number | null;
  lastError: string | null;
  createdAt: number;
}

function rowToSource(row: SourceRow): RadarSource {
  return {
    ...row,
    kind: row.kind as RadarSource["kind"],
    enabled: row.enabled === 1,
  };
}

interface ItemRow {
  id: string;
  sourceId: string;
  title: string;
  platform: string;
  url: string | null;
  heat: number;
  heatText: string;
  summary: string;
  hash: string;
  fetchedAt: number;
}

function rowToItem(row: ItemRow): RadarItem {
  return row;
}

interface SubRow {
  id: string;
  keyword: string;
  platformsJson: string;
  heatThreshold: number;
  quietStart: number | null;
  quietEnd: number | null;
  channelsJson: string;
  enabled: number;
  createdAt: number;
}

function rowToSub(row: SubRow): RadarSub {
  return {
    id: row.id,
    keyword: row.keyword,
    platforms: JSON.parse(row.platformsJson) as string[],
    heatThreshold: row.heatThreshold,
    quietStart: row.quietStart,
    quietEnd: row.quietEnd,
    channelIds: JSON.parse(row.channelsJson) as string[],
    enabled: row.enabled === 1,
    createdAt: row.createdAt,
  };
}

export function seedRadarSources(): void {
  const count = (db.query("SELECT COUNT(*) AS n FROM radar_sources").get() as { n: number }).n;
  if (count > 0) return;
  const t = now();
  for (const tpl of sourceTemplates) {
    db.run(
      `INSERT INTO radar_sources (id, name, kind, platform, queryTemplate, intervalMinutes, enabled, lastRunAt, createdAt)
       VALUES (?, ?, 'ai-query', ?, ?, ?, 1, ?, ?)`,
      [tpl.id, tpl.name, tpl.platform, tpl.queryTemplate, tpl.intervalMinutes, t, t],
    );
  }
}

export function listSources(): RadarSource[] {
  return (db.query("SELECT * FROM radar_sources ORDER BY createdAt ASC").all() as SourceRow[]).map(rowToSource);
}

export function getSource(id: string): RadarSource | null {
  const row = db.query("SELECT * FROM radar_sources WHERE id = ?").get(id) as SourceRow | null;
  return row ? rowToSource(row) : null;
}

export function createSource(input: {
  name: string;
  platform?: string;
  focus?: string;
  queryTemplate?: string;
  intervalMinutes?: number;
  endpointId?: string | null;
}): RadarSource {
  const id = newId();
  const platform = input.platform?.trim() || input.name.trim();
  const queryTemplate = input.queryTemplate?.trim() || buildFocusTemplate(input.focus || input.name);
  db.run(
    `INSERT INTO radar_sources (id, name, kind, platform, queryTemplate, intervalMinutes, endpointId, enabled, createdAt)
     VALUES (?, ?, 'ai-query', ?, ?, ?, ?, 1, ?)`,
    [id, input.name.trim(), platform, queryTemplate, input.intervalMinutes ?? 360, input.endpointId ?? null, now()],
  );
  return getSource(id)!;
}

export function updateSource(
  id: string,
  patch: Partial<Pick<RadarSource, "name" | "queryTemplate" | "intervalMinutes" | "endpointId" | "enabled">>,
): RadarSource | null {
  const cur = getSource(id);
  if (!cur) return null;
  db.run(
    `UPDATE radar_sources SET name = ?, queryTemplate = ?, intervalMinutes = ?, endpointId = ?, enabled = ? WHERE id = ?`,
    [
      patch.name ?? cur.name,
      patch.queryTemplate ?? cur.queryTemplate,
      patch.intervalMinutes ?? cur.intervalMinutes,
      patch.endpointId === undefined ? cur.endpointId : patch.endpointId,
      (patch.enabled ?? cur.enabled) ? 1 : 0,
      id,
    ],
  );
  return getSource(id);
}

export function deleteSource(id: string): boolean {
  if (id.startsWith("tpl_")) {
    db.run("UPDATE radar_sources SET enabled = 0 WHERE id = ?", [id]);
    return true;
  }
  return db.run("DELETE FROM radar_sources WHERE id = ?", [id]).changes > 0;
}

export function listItems(opts: { platform?: string; q?: string; limit?: number } = {}): RadarItem[] {
  const limit = opts.limit ?? 60;
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (opts.platform) {
    where.push("platform = ?");
    params.push(opts.platform);
  }
  if (opts.q?.trim()) {
    where.push("(title LIKE ? OR summary LIKE ?)");
    params.push(`%${opts.q.trim()}%`, `%${opts.q.trim()}%`);
  }
  const sql = `SELECT * FROM radar_items ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY fetchedAt DESC, heat DESC LIMIT ?`;
  params.push(limit);
  return (db.query(sql).all(...params) as ItemRow[]).map(rowToItem);
}

export function getItem(id: string): RadarItem | null {
  const row = db.query("SELECT * FROM radar_items WHERE id = ?").get(id) as ItemRow | null;
  return row ? rowToItem(row) : null;
}

export function listSubs(): RadarSub[] {
  return (db.query("SELECT * FROM radar_subs ORDER BY createdAt DESC").all() as SubRow[]).map(rowToSub);
}

export function createSub(input: {
  keyword: string;
  platforms?: string[];
  heatThreshold?: number;
  quietStart?: number | null;
  quietEnd?: number | null;
  channelIds?: string[];
}): RadarSub {
  const id = newId();
  db.run(
    `INSERT INTO radar_subs (id, keyword, platformsJson, heatThreshold, quietStart, quietEnd, channelsJson, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.keyword.trim(),
      JSON.stringify(input.platforms ?? []),
      input.heatThreshold ?? 60,
      input.quietStart ?? null,
      input.quietEnd ?? null,
      JSON.stringify(input.channelIds ?? []),
      now(),
    ],
  );
  return listSubs().find((s) => s.id === id)!;
}

export function updateSub(id: string, patch: Partial<RadarSub>): RadarSub | null {
  const cur = listSubs().find((s) => s.id === id);
  if (!cur) return null;
  db.run(
    `UPDATE radar_subs SET keyword = ?, platformsJson = ?, heatThreshold = ?, quietStart = ?, quietEnd = ?, channelsJson = ?, enabled = ? WHERE id = ?`,
    [
      patch.keyword ?? cur.keyword,
      JSON.stringify(patch.platforms ?? cur.platforms),
      patch.heatThreshold ?? cur.heatThreshold,
      patch.quietStart === undefined ? cur.quietStart : patch.quietStart,
      patch.quietEnd === undefined ? cur.quietEnd : patch.quietEnd,
      JSON.stringify(patch.channelIds ?? cur.channelIds),
      (patch.enabled ?? cur.enabled) ? 1 : 0,
      id,
    ],
  );
  return listSubs().find((s) => s.id === id) ?? null;
}

export function deleteSub(id: string): boolean {
  return db.run("DELETE FROM radar_subs WHERE id = ?", [id]).changes > 0;
}

export function getRadarSettings(): RadarSettings {
  return getSetting<RadarSettings>("radar.settings", {
    digestEnabled: false,
    digestHour: 8,
    lastDigestDate: null,
  });
}

export function saveRadarSettings(patch: Partial<RadarSettings>): RadarSettings {
  const next = { ...getRadarSettings(), ...patch };
  setSetting("radar.settings", next);
  return next;
}

export function hasWebSearchLlm(): boolean {
  return listEndpoints("llm").some((e) => e.enabled && e.webSearch);
}

export function resolveRadarLlm(preferredId?: string | null) {
  if (preferredId) {
    const ep = resolveEndpoint("llm", preferredId);
    if (!ep) throw new Error("指定的文本模型不存在");
    if (!ep.webSearch) {
      throw new Error(
        `端点「${ep.name}」还没勾选「支持联网搜索」。雷达要靠模型去网上查热点，请到「模型」页打开这个开关。`,
      );
    }
    return ep;
  }
  const web = listEndpoints("llm").filter((e) => e.enabled && e.webSearch);
  if (web.length === 0) {
    throw new Error("还没有会联网的文本模型。到「模型」页添加一个文本模型，并勾选「支持联网搜索」。");
  }
  const pick = web.find((e) => e.isDefault) ?? web[0]!;
  return getEndpoint(pick.id, true)!;
}

export function dueSources(nowTs = Date.now()): RadarSource[] {
  return listSources().filter((s) => s.enabled && isDue(s.lastRunAt, s.intervalMinutes, nowTs));
}

async function notifyHits(item: RadarItem): Promise<void> {
  for (const sub of listSubs()) {
    if (!matchSubscription(item, sub)) continue;
    if (inQuietHours(sub)) continue;
    await deliverToIds(
      sub.channelIds,
      {
        title: `热点命中「${sub.keyword}」`,
        body: `[${item.platform} · ${item.heatText || "AI 估计 " + item.heat}]\n${item.title}\n${item.summary}`,
        url: `${publicBase()}/radar?item=${item.id}`,
      },
      sub,
    );
  }
}

export const fetchRadarHandler: JobHandler = async (job, ctx) => {
  const { sourceId } = JSON.parse(job.payloadJson) as { sourceId: string };
  try {
    return await runFetch(job, ctx);
  } catch (e) {
    markSourceError(sourceId, e instanceof Error ? e.message : String(e));
    throw e;
  }
};

const runFetch: JobHandler = async (job, ctx) => {
  const { sourceId } = JSON.parse(job.payloadJson) as { sourceId: string };
  const source = getSource(sourceId);
  if (!source) throw new Error("观察源不存在");
  if (source.kind !== "ai-query") throw new Error("这类源还没接上，本期只用 AI 联网查询");

  ctx.progress(0.1, "找联网文本模型");
  const endpoint = resolveRadarLlm(source.endpointId);
  const adapter = getAdapter(endpoint.adapterType);
  if (!adapter?.chat) throw new Error("这个模型不会聊天，换一个文本模型");

  ctx.progress(0.25, `正在问 ${endpoint.name}`);
  const text = await chatMetered(
    adapter,
    endpoint,
    {
      system: RADAR_SYSTEM,
      prompt: source.queryTemplate,
      webSearch: true,
    },
    { jobType: "radar.fetch" },
  );

  ctx.progress(0.7, "整理热点");
  const parsed = parseRadarResponse(text, source.platform);
  let inserted = 0;
  for (const p of parsed) {
    const hash = itemHash(p.title, p.platform, p.url);
    const exists = db.query("SELECT id FROM radar_items WHERE hash = ?").get(hash) as { id: string } | null;
    if (exists) continue;
    const item: RadarItem = {
      id: newId(),
      sourceId: source.id,
      title: p.title,
      platform: p.platform,
      url: p.url,
      heat: p.heat,
      heatText: p.heatText,
      summary: p.summary,
      hash,
      fetchedAt: now(),
    };
    db.run(
      `INSERT INTO radar_items (id, sourceId, title, platform, url, heat, heatText, summary, hash, fetchedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [item.id, item.sourceId, item.title, item.platform, item.url, item.heat, item.heatText, item.summary, item.hash, item.fetchedAt],
    );
    wsHub.broadcast({ type: "radar.upsert", item });
    inserted++;
    await notifyHits(item);
  }

  db.run("UPDATE radar_sources SET lastRunAt = ?, lastError = NULL WHERE id = ?", [now(), source.id]);
  ctx.progress(1, `新增 ${inserted} 条`);
  return { inserted, parsed: parsed.length };
};

export function markSourceError(sourceId: string, message: string): void {
  db.run("UPDATE radar_sources SET lastRunAt = ?, lastError = ? WHERE id = ?", [now(), message.slice(0, 240), sourceId]);
}

export const digestRadarHandler: JobHandler = async (_job, ctx) => {
  ctx.progress(0.2, "汇总今日热点");
  const since = Date.now() - 24 * 3600_000;
  const items = (
    db.query("SELECT * FROM radar_items WHERE fetchedAt >= ? ORDER BY heat DESC LIMIT 10").all(since) as ItemRow[]
  ).map(rowToItem);
  if (items.length === 0) {
    ctx.progress(1, "今天还没有热点");
    return { sent: false, reason: "empty" };
  }
  const body = items
    .map((it, i) => `${i + 1}. [${it.platform} ${it.heat}] ${it.title}${it.summary ? ` — ${it.summary}` : ""}`)
    .join("\n");
  ctx.progress(0.6, "推送早报");
  await deliverToIds(
    [],
    {
      title: "今日热点早报",
      body,
      url: `${publicBase()}/radar`,
    },
    null,
  );
  const settings = getRadarSettings();
  saveRadarSettings({
    ...settings,
    lastDigestDate: (() => {
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    })(),
  });
  ctx.progress(1, "早报已发出");
  return { sent: true, count: items.length };
};

/** 热点 → 快速建项目并搭好「文本→文生图」画布 */
export function projectFromItem(itemId: string): { projectId: string; name: string } {
  const item = getItem(itemId);
  if (!item) throw new Error("这条热点不存在或已过期");

  const name = sanitizeTitle(item.title, 16) || "热点选题";
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
    JSON.stringify({ id, name, version: 1, source: "radar", itemId, createdAt: new Date(t).toISOString() }, null, 2),
    "utf-8",
  );
  db.run("INSERT INTO projects (id, name, directory, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)", [id, name, dir, t, t]);

  const shot = `根据这个正在热议的话题做一条短视频画面：${item.title}。${item.summary}。电影感构图，信息清晰，适合竖屏或横屏封面。`;
  const canvasId = newId();
  const relPath = "canvas/主画布.json";
  const doc = {
    version: 1,
    nodes: [
      { id: "text_0", type: "textNode", position: { x: 80, y: 120 }, data: { text: shot } },
      {
        id: "gen_0",
        type: "imageGenNode",
        position: { x: 400, y: 100 },
        data: { prompt: "", size: "1024x1024", endpointId: null, status: "idle" },
      },
    ],
    edges: [{ id: "e_0", source: "text_0", sourceHandle: "out", target: "gen_0", targetHandle: "prompt", animated: true }],
    viewport: null,
  };
  writeFileSync(join(dir, relPath), JSON.stringify(doc), "utf-8");
  db.run("INSERT INTO canvas_docs (id, projectId, name, path, updatedAt) VALUES (?, ?, ?, ?, ?)", [
    canvasId, id, "主画布", relPath, t,
  ]);

  return { projectId: id, name };
}
