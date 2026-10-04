import { Hono } from "hono";
import type { SeriesKind } from "@vw/core";
import { clipNovel, fetchNovelText, looksLikeHttpUrl } from "@vw/pipeline";
import { err, ok } from "../lib/resp";
import { createSeries, getSeries, listSeries } from "../services/series";

export const seriesRoutes = new Hono();

seriesRoutes.get("/", (c) => ok(c, listSeries()));

seriesRoutes.post("/", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { name?: string; kind?: SeriesKind; stylePackId?: string; substyle?: string };
  if (!body.name?.trim()) return err(c, "先给这部连载起个名字");
  const kind = body.kind === "free" || body.kind === "whiteboard" ? body.kind : "drama";
  return ok(c, createSeries({ name: body.name.trim(), kind, stylePackId: body.stylePackId, substyle: body.substyle }));
});

/** 拉一篇能直接打开的小说页 */
seriesRoutes.post("/fetch", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { url?: string };
  const url = body.url?.trim() ?? "";
  if (!looksLikeHttpUrl(url)) return err(c, "贴一个能直接打开的小说链接，或改成上传 txt。");
  try {
    const doc = await fetchNovelText(url);
    return ok(c, doc);
  } catch (e) {
    return err(c, e instanceof Error ? e.message : String(e), 422);
  }
});

seriesRoutes.post("/clip", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { text?: string };
  if (!body.text?.trim()) return err(c, "还没有正文");
  return ok(c, clipNovel(body.text));
});

seriesRoutes.get("/:id", (c) => {
  const s = getSeries(c.req.param("id"));
  if (!s) return err(c, "这部连载不存在", 404);
  return ok(c, s);
});
