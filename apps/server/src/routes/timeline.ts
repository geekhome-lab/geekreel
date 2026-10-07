import { Hono } from "hono";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { emptyTimelineDoc, layBgm, type TimelineDoc } from "@vw/core";
import { buildFinishTimeline } from "@vw/pipeline";
import { db } from "../db";
import { jobQueue } from "../jobs/queue";
import { err, now, ok } from "../lib/resp";
import { collectFinishClips } from "../services/dub";
import { exportJianyingDraft } from "../services/jianying";
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

function isPortraitProject(projectId: string): boolean {
  const proj = db.query("SELECT seriesId FROM projects WHERE id = ?").get(projectId) as { seriesId: string | null } | null;
  if (!proj?.seriesId) return true;
  const series = db.query("SELECT kind FROM series WHERE id = ?").get(proj.seriesId) as { kind: string } | null;
  return series?.kind === "drama" || series?.kind === "free" || series?.kind === "whiteboard";
}

export const timelineRoutes = new Hono();

timelineRoutes.get("/project/:projectId", (c) => {
  const abs = timelineAbs(c.req.param("projectId"));
  if (!abs) return err(c, "项目不存在", 404);
  if (!existsSync(abs)) {
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, JSON.stringify(emptyTimelineDoc({ portrait: isPortraitProject(c.req.param("projectId")) }), null, 2), "utf-8");
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
 * 只装画面和台词，不配音。正式出片走 /finish。
 */
timelineRoutes.post("/project/:projectId/from-canvas", async (c) => {
  const projectId = c.req.param("projectId");
  if (!projectDir(projectId)) return err(c, "项目不存在", 404);
  const body = (await c.req.json().catch(() => ({}))) as { withSubtitles?: boolean };
  try {
    const clips = collectFinishClips(projectId);
    if (clips.length === 0) return err(c, "画布上还没有生成好的画面。先出片。", 422);
    const doc = buildFinishTimeline(clips, {
      portrait: isPortraitProject(projectId),
      withSubtitles: body.withSubtitles !== false,
    });
    const abs = timelineAbs(projectId)!;
    mkdirSync(join(abs, ".."), { recursive: true });
    const tmp = `${abs}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(doc), "utf-8");
    renameSync(tmp, abs);
    return ok(c, { doc, clipCount: clips.length });
  } catch (e) {
    return err(c, e instanceof Error ? e.message : String(e), 422);
  }
});

/** 视频 + 剧本装上时间线，并自动配音 */
timelineRoutes.post("/project/:projectId/finish", async (c) => {
  const projectId = c.req.param("projectId");
  if (!projectDir(projectId)) return err(c, "项目不存在", 404);
  const busy = db
    .query(
      "SELECT * FROM jobs WHERE projectId = ? AND type = 'timeline.finish' AND status IN ('queued', 'running') LIMIT 1",
    )
    .get(projectId) as Record<string, unknown> | null;
  if (busy) return ok(c, busy);
  const body = (await c.req.json().catch(() => ({}))) as {
    withSubtitles?: boolean;
    dub?: boolean;
    voice?: string;
    ttsEndpointId?: string;
  };
  const job = jobQueue.submit(
    "timeline.finish",
    {
      projectId,
      withSubtitles: body.withSubtitles !== false,
      dub: body.dub === true,
      voice: body.voice,
      ttsEndpointId: body.ttsEndpointId,
    },
    projectId,
  );
  return ok(c, job);
});

/** 提交导出任务 */
timelineRoutes.post("/render", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { projectId?: string; burnSubs?: boolean };
  if (!body.projectId) return err(c, "缺少 projectId");
  if (!projectDir(body.projectId)) return err(c, "项目不存在", 404);
  const job = jobQueue.submit(
    "timeline.render",
    { projectId: body.projectId, burnSubs: body.burnSubs !== false },
    body.projectId,
  );
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

/** 铺一层配乐，并记住给下一集用 */
timelineRoutes.post("/project/:projectId/bgm", async (c) => {
  const projectId = c.req.param("projectId");
  const abs = timelineAbs(projectId);
  if (!abs) return err(c, "项目不存在", 404);
  const body = (await c.req.json().catch(() => null)) as { assetId?: string; volume?: number } | null;
  if (!body?.assetId) return err(c, "先选一段配乐");
  if (!existsSync(abs)) return err(c, "时间线还是空的", 422);
  const doc = JSON.parse(readFileSync(abs, "utf-8")) as TimelineDoc;
  const next = layBgm(doc, body.assetId, { volume: body.volume });
  const tmp = `${abs}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(next));
  renameSync(tmp, abs);

  const pipe = db
    .query("SELECT id, stateJson FROM pipelines WHERE projectId = ? ORDER BY updatedAt DESC LIMIT 1")
    .get(projectId) as { id: string; stateJson: string } | null;
  if (pipe) {
    try {
      const st = JSON.parse(pipe.stateJson) as { bible?: { bgmAssetId?: string | null } };
      if (st.bible) {
        st.bible.bgmAssetId = body.assetId;
        db.run("UPDATE pipelines SET stateJson = ?, updatedAt = ? WHERE id = ?", [JSON.stringify(st), now(), pipe.id]);
      }
    } catch {
      /* 时间线已经铺上 */
    }
  }
  const dir = projectDir(projectId);
  if (dir) {
    const biblePath = join(dir, "pipeline", "bible.json");
    if (existsSync(biblePath)) {
      try {
        const bible = JSON.parse(readFileSync(biblePath, "utf-8")) as { bgmAssetId?: string | null };
        bible.bgmAssetId = body.assetId;
        writeFileSync(biblePath, JSON.stringify(bible, null, 2));
      } catch {
        /* 圣经写失败不影响时间线 */
      }
    }
  }
  return ok(c, { doc: next });
});

timelineRoutes.post("/project/:projectId/jianying", (c) => {
  const projectId = c.req.param("projectId");
  if (!projectDir(projectId)) return err(c, "项目不存在", 404);
  try {
    return ok(c, exportJianyingDraft(projectId));
  } catch (e) {
    return err(c, e instanceof Error ? e.message : String(e), 422);
  }
});
