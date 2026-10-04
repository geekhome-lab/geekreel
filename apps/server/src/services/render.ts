import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatSrt, subtitleCues, type TimelineDoc } from "@vw/core";
import { buildRenderPlan, detectBins, executeRender, hasSubtitlesFilter, type RenderAssetInfo } from "@vw/media";
import { db } from "../db";
import type { JobHandler } from "../jobs/queue";
import { absInLibrary, storeAsset } from "./library";

/**
 * timeline.render：时间线 JSON → ffmpeg 渲染 → 项目 export/ 目录。
 * 产物同时硬链接注册进资产库（source=pipeline），方便在资产库预览管理。
 */
export const renderTimelineHandler: JobHandler = async (job, ctx) => {
  const { projectId } = JSON.parse(job.payloadJson) as { projectId: string };
  const project = db.query("SELECT * FROM projects WHERE id = ?").get(projectId) as
    | { id: string; name: string; directory: string }
    | null;
  if (!project) throw new Error("项目不存在");

  const bins = await detectBins();
  if (!bins.available || !bins.ffmpeg) throw new Error("ffmpeg 不可用");

  // 1. 读时间线
  ctx.progress(0.03, "读取时间线");
  const timelinePath = join(project.directory, "timeline", "main.json");
  if (!existsSync(timelinePath)) throw new Error("时间线不存在，请先在时间线页编辑");
  const doc = JSON.parse(readFileSync(timelinePath, "utf-8")) as TimelineDoc;

  // 2. 解析片段引用的资产
  ctx.progress(0.06, "解析素材");
  const assets = new Map<string, RenderAssetInfo>();
  for (const track of doc.tracks) {
    for (const clip of track.clips) {
      if (!clip.assetId || assets.has(clip.assetId)) continue;
      const row = db.query("SELECT * FROM assets WHERE id = ?").get(clip.assetId) as
        | { path: string; type: string; metaJson: string }
        | null;
      if (!row) throw new Error("有片段引用的资产已被删除");
      const abs = absInLibrary(row.path);
      if (!existsSync(abs)) throw new Error(`素材文件丢失：${row.path}`);
      const meta = JSON.parse(row.metaJson || "{}") as { audioCodec?: string | null };
      assets.set(clip.assetId, {
        absPath: abs,
        hasAudio: row.type !== "image" && !!meta.audioCodec,
        isStill: row.type === "image",
      });
    }
  }

  // 3. 字幕：字幕轨 → SRT；支持 libass 则烧录，否则软封装 mov_text
  const cues = subtitleCues(doc);
  let srtPath: string | undefined;
  let burnSubs = false;
  if (cues.length > 0) {
    const tmpDir = join(project.directory, "pipeline");
    mkdirSync(tmpDir, { recursive: true });
    srtPath = join(tmpDir, "render-subtitles.srt");
    writeFileSync(srtPath, formatSrt(cues), "utf-8");
    burnSubs = await hasSubtitlesFilter(bins.ffmpeg);
  }

  // 4. 输出路径：export/yyyyMMdd-HHmm_项目名.mp4
  const exportDir = join(project.directory, "export");
  mkdirSync(exportDir, { recursive: true });
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const safeName = project.name.replace(/[\\/:*?"<>|]/g, " ").trim().slice(0, 24) || "未命名";
  const outPath = join(exportDir, `${stamp}_${safeName}.mp4`);

  // 5. 构建并执行渲染
  const plan = buildRenderPlan(doc, assets, { srtPath, burnSubs, outPath });
  ctx.progress(0.1, `渲染 ${plan.videoClipCount} 个片段`);
  await executeRender(bins.ffmpeg, plan, (r) => ctx.progress(0.1 + r * 0.85, "渲染中"), ctx.signal);

  // 6. 收入资产库：优先硬链接（零拷贝），失败回退拷贝
  ctx.progress(0.97, "收入资产库");
  const title = outPath.split("/").pop()!.replace(/\.mp4$/i, "");
  let assetId: string | null = null;
  try {
    assetId = storeAsset({
      type: "video",
      title,
      ext: "mp4",
      source: "pipeline",
      projectId,
      linkFromPath: outPath,
    }).id;
  } catch {
    assetId = storeAsset({
      type: "video",
      title,
      ext: "mp4",
      source: "pipeline",
      projectId,
      fromPath: outPath,
    }).id;
  }

  ctx.progress(1, "导出完成");
  return {
    outputPath: outPath,
    assetId,
    durationMs: plan.outputDurationMs,
    subtitles: plan.subtitles,
  };
};
