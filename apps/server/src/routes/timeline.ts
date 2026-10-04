import { Hono } from "hono";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { emptyTimelineDoc, type TimelineDoc } from "@vw/core";
import { db } from "../db";
import { jobQueue } from "../jobs/queue";
import { err, ok } from "../lib/resp";
import { listEndpoints } from "../services/models";

/**
 * 时间线文档：项目目录 timeline/main.json（M3 一个项目一条主时间线）。
 */

function projectDir(projectId: string): string | null {
  const row = db.query("SELECT directory, name FROM projects WHERE id = ?").get(projectId) as
    | { directory: string; name: string }
    | null;
  return row?.directory ?? null;
}

function timelineAbs(projectId: string): string | null {
  const dir = projectDir(projectId);
  return dir ? join(dir, "timeline", "main.json") : null;
}

export const timelineRoutes = new Hono();

timelineRoutes.get("/project/:projectId", (c) => {
  const abs = timelineAbs(c.req.param("projectId"));
  if (!abs) return err(c, "项目不存在", 404);
  if (!existsSync(abs)) {
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, JSON.stringify(emptyTimelineDoc(), null, 2), "utf-8");
  }
  try {
    return ok(c, { doc: JSON.parse(readFileSync(abs, "utf-8")) as TimelineDoc });
  } catch {
    return err(c, "时间线文件损坏", 500);
  }
});

timelineRoutes.put("/project/:projectId", async (c) => {
  const abs = timelineAbs(c.req.param("projectId"));
  if (!abs) return err(c, "项目不存在", 404);
  const body = (await c.req.json().catch(() => null)) as { doc?: TimelineDoc } | null;
  if (!body?.doc || body.doc.version !== 1 || !Array.isArray(body.doc.tracks)) {
    return err(c, "时间线文档不合法");
  }
  mkdirSync(join(abs, ".."), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(body.doc), "utf-8");
  renameSync(tmp, abs);
  return ok(c, { saved: true });
});

/**
 * 从画布一键装配时间线（小白路径）：
 * 已完成的文生图节点按从左到右排成视频轨；对应文本节点写成字幕。
 */
timelineRoutes.post("/project/:projectId/from-canvas", async (c) => {
  const projectId = c.req.param("projectId");
  const dir = projectDir(projectId);
  if (!dir) return err(c, "项目不存在", 404);

  const canvasRow = db
    .query("SELECT path FROM canvas_docs WHERE projectId = ? ORDER BY updatedAt DESC LIMIT 1")
    .get(projectId) as { path: string } | null;
  if (!canvasRow) return err(c, "这个项目还没有画布，先去首页或画布页生成画面");

  const canvasAbs = join(dir, canvasRow.path);
  if (!existsSync(canvasAbs)) return err(c, "画布文件丢失", 404);
  const canvas = JSON.parse(readFileSync(canvasAbs, "utf-8")) as {
    nodes?: Array<{ id: string; type?: string; position?: { x: number }; data?: Record<string, unknown> }>;
    edges?: Array<{ source: string; target: string; targetHandle?: string }>;
  };

  const genNodes = (canvas.nodes ?? [])
    .filter((n) => n.type === "imageGenNode" && typeof n.data?.assetId === "string")
    .sort((a, b) => (a.position?.x ?? 0) - (b.position?.x ?? 0));
  if (genNodes.length === 0) return err(c, "画布上还没有生成好的画面。先在首页或画布点「运行」。", 422);

  const edges = canvas.edges ?? [];
  const nodesById = new Map((canvas.nodes ?? []).map((n) => [n.id, n]));
  const shotMs = 3000;
  const doc = emptyTimelineDoc();
  const vTrack = doc.tracks.find((t) => t.type === "video")!;
  const sTrack = doc.tracks.find((t) => t.type === "subtitle")!;

  genNodes.forEach((n, i) => {
    const startMs = i * shotMs;
    vTrack.clips.push({
      id: `c_v_${i}`,
      assetId: n.data!.assetId as string,
      startMs,
      inMs: 0,
      outMs: shotMs,
      volume: 1,
    });
    const textEdge = edges.find((e) => e.target === n.id && e.targetHandle === "prompt");
    const textNode = textEdge ? nodesById.get(textEdge.source) : undefined;
    const text = typeof textNode?.data?.text === "string" ? textNode.data.text.trim() : "";
    if (text) {
      sTrack.clips.push({
        id: `c_s_${i}`,
        text: text.slice(0, 80),
        startMs,
        inMs: 0,
        outMs: shotMs,
        volume: 1,
      });
    }
  });

  const abs = timelineAbs(projectId)!;
  mkdirSync(join(abs, ".."), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(doc), "utf-8");
  renameSync(tmp, abs);
  return ok(c, { doc, clipCount: genNodes.length });
});

/** 提交导出任务 */
timelineRoutes.post("/render", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { projectId?: string };
  if (!body.projectId) return err(c, "缺少 projectId");
  if (!projectDir(body.projectId)) return err(c, "项目不存在", 404);
  const job = jobQueue.submit("timeline.render", { projectId: body.projectId }, body.projectId);
  return ok(c, job);
});

/** 字幕轨逐条配音，落到音频轨 */
timelineRoutes.post("/tts", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { projectId?: string; endpointId?: string };
  if (!body.projectId) return err(c, "缺少 projectId");
  if (!projectDir(body.projectId)) return err(c, "项目不存在", 404);
  if (!listEndpoints("tts").some((e) => e.enabled)) {
    return err(c, "还没有语音模型。到「模型」页加一个，模型名一般是 tts-1。", 422);
  }
  const job = jobQueue.submit("timeline.tts", { projectId: body.projectId, endpointId: body.endpointId }, body.projectId);
  return ok(c, job);
});
