import { Hono } from "hono";
import { jobQueue } from "../jobs/queue";
import { err, ok } from "../lib/resp";
import { analyzeStatus, getReport, listReports, readFrame } from "../services/analyze";
import { looksLikeVideoUrl } from "@vw/analyze";

export const analyzeRoutes = new Hono();

analyzeRoutes.get("/status", (c) => ok(c, analyzeStatus()));

analyzeRoutes.get("/", (c) => ok(c, listReports()));

analyzeRoutes.get("/:id", (c) => {
  const report = getReport(c.req.param("id"));
  if (!report) return err(c, "报告不存在", 404);
  return ok(c, report);
});

analyzeRoutes.get("/:id/frames/:file", (c) => {
  const file = c.req.param("file");
  const data = readFrame(c.req.param("id"), file);
  if (!data) return err(c, "抽帧不存在", 404);
  return new Response(Buffer.from(data), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" } });
});

analyzeRoutes.post("/", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { url?: string; assetId?: string; endpointId?: string };
  const url = body.url?.trim();
  if (!body.assetId && !url) return err(c, "请粘贴视频链接，或从资产库选一条");
  if (url && !looksLikeVideoUrl(url)) return err(c, "这不像视频链接。抖音/B站/YouTube/TikTok 的分享链接都可以。");
  const job = jobQueue.submit("analyze.run", {
    url: url || undefined,
    assetId: body.assetId,
    endpointId: body.endpointId,
  });
  return ok(c, job);
});
