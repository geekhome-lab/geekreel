import { Hono } from "hono";
import type { RadarSettings } from "@vw/core";
import { intervalPresets } from "@vw/core";
import { sourceTemplates } from "@vw/radar";
import { jobQueue } from "../jobs/queue";
import { err, ok } from "../lib/resp";
import {
  createSource,
  createSub,
  deleteSource,
  deleteSub,
  getItem,
  getRadarSettings,
  getSource,
  hasFeedSources,
  hasWebSearchLlm,
  listBoardSources,
  listItems,
  listSources,
  radarTrend,
  listSubs,
  storyFromItem,
  saveRadarSettings,
  updateSource,
  updateSub,
} from "../services/radar";

export const radarRoutes = new Hono();

radarRoutes.get("/status", (c) => {
  const sources = listSources();
  return ok(c, {
    hasWebSearchLlm: hasWebSearchLlm(),
    hasFeedSources: hasFeedSources(),
    sourceCount: sources.length,
    enabledCount: sources.filter((s) => s.enabled).length,
    lastRunAt: sources.reduce<number | null>((m, s) => (s.lastRunAt && (!m || s.lastRunAt > m) ? s.lastRunAt : m), null),
  });
});

radarRoutes.get("/templates", (c) => ok(c, sourceTemplates));
radarRoutes.get("/intervals", (c) => ok(c, intervalPresets));

radarRoutes.get("/board", (c) => {
  const platform = c.req.query("platform") || undefined;
  const q = c.req.query("q") || undefined;
  return ok(c, listItems({ platform, q, limit: 120, boardOnly: true }));
});

radarRoutes.get("/trend", (c) => ok(c, radarTrend(14)));

radarRoutes.get("/items/:id", (c) => {
  const item = getItem(c.req.param("id"));
  if (!item) return err(c, "热点不存在", 404);
  return ok(c, item);
});

radarRoutes.get("/sources", (c) => {
  if (c.req.query("board") === "1") return ok(c, listBoardSources());
  return ok(c, listSources());
});

radarRoutes.post("/sources", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    kind?: "ai-query" | "rss" | "http-api";
    platform?: string;
    focus?: string;
    queryTemplate?: string;
    intervalMinutes?: number;
    endpointId?: string | null;
  };
  if (!body.name?.trim()) return err(c, "请给这个观察起个名字，比如「电商」");
  try {
    return ok(c, createSource({ ...body, name: body.name.trim() }));
  } catch (e) {
    return err(c, e instanceof Error ? e.message : String(e));
  }
});

radarRoutes.patch("/sources/:id", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    queryTemplate?: string;
    intervalMinutes?: number;
    endpointId?: string | null;
    enabled?: boolean;
  };
  const src = updateSource(c.req.param("id"), body);
  if (!src) return err(c, "观察源不存在", 404);
  return ok(c, src);
});

radarRoutes.delete("/sources/:id", (c) => {
  if (!deleteSource(c.req.param("id"))) return err(c, "观察源不存在", 404);
  return ok(c, { deleted: true });
});

radarRoutes.post("/sources/:id/run", async (c) => {
  const src = getSource(c.req.param("id"));
  if (!src) return err(c, "观察源不存在", 404);
  if (src.kind === "ai-query" && !hasWebSearchLlm() && !src.endpointId) {
    return err(c, "还没有会联网的文本模型。到「模型」页添加一个，并勾选「支持联网搜索」。", 422);
  }
  const body = (await c.req.json().catch(() => ({}))) as { q?: string };
  const q = body.q?.trim() || undefined;
  const job = jobQueue.submit("radar.fetch", { sourceId: src.id, q });
  return ok(c, job);
});

radarRoutes.post("/run-all", (c) => {
  const sources = listSources().filter((s) => s.enabled);
  if (sources.length === 0) return err(c, "没有开启的观察源，先打开至少一个平台");
  const needsLlm = sources.some((s) => s.kind === "ai-query");
  if (needsLlm && !hasWebSearchLlm()) {
    return err(c, "还没有会联网的文本模型。到「模型」页添加一个，并勾选「支持联网搜索」。也可以先加 RSS / 接口源再刷新。", 422);
  }
  const jobs = sources.map((s) => jobQueue.submit("radar.fetch", { sourceId: s.id }));
  return ok(c, { jobs, count: jobs.length });
});

radarRoutes.get("/subs", (c) => ok(c, listSubs()));

radarRoutes.post("/subs", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    keyword?: string;
    platforms?: string[];
    heatThreshold?: number;
    quietStart?: number | null;
    quietEnd?: number | null;
    channelIds?: string[];
  };
  if (!body.keyword?.trim()) return err(c, "请填写要盯的关键词");
  return ok(c, createSub({ ...body, keyword: body.keyword }));
});

radarRoutes.patch("/subs/:id", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Partial<{
    keyword: string;
    platforms: string[];
    heatThreshold: number;
    quietStart: number | null;
    quietEnd: number | null;
    channelIds: string[];
    enabled: boolean;
  }>;
  const sub = updateSub(c.req.param("id"), body);
  if (!sub) return err(c, "订阅不存在", 404);
  return ok(c, sub);
});

radarRoutes.delete("/subs/:id", (c) => {
  if (!deleteSub(c.req.param("id"))) return err(c, "订阅不存在", 404);
  return ok(c, { deleted: true });
});

radarRoutes.get("/settings", (c) => ok(c, getRadarSettings()));

radarRoutes.put("/settings", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Partial<RadarSettings>;
  return ok(c, saveRadarSettings(body));
});

radarRoutes.post("/to-story", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { itemId?: string };
  if (!body.itemId) return err(c, "缺少热点");
  try {
    return ok(c, await storyFromItem(body.itemId));
  } catch (e) {
    return err(c, e instanceof Error ? e.message : String(e));
  }
});

/** 旧入口：同样只提炼想法，不再直接出片 */
radarRoutes.post("/to-project", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { itemId?: string };
  if (!body.itemId) return err(c, "缺少热点");
  try {
    return ok(c, await storyFromItem(body.itemId));
  } catch (e) {
    return err(c, e instanceof Error ? e.message : String(e));
  }
});
