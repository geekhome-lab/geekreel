import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { SQLQueryBindings } from "bun:sqlite";
import {
  audioWaveform,
  detectBins,
  imageThumbnail,
  probe,
  videoProxy,
  videoThumbnail,
} from "@vw/media";
import { db } from "../db";
import type { JobHandler } from "../jobs/queue";
import { absInLibrary, broadcastAsset, getAsset, proxyAbs, thumbAbs } from "./library";

/**
 * asset.index：探测元数据 → 缩略图/波形 → 视频代理。
 * ffmpeg 缺失时降级：只记录基础信息，任务照常完成。
 */
export const indexAssetHandler: JobHandler = async (job, ctx) => {
  const { assetId } = JSON.parse(job.payloadJson) as { assetId: string };
  const asset = getAsset(assetId);
  if (!asset) throw new Error("资产不存在");

  const abs = absInLibrary(asset.path);
  if (!existsSync(abs)) throw new Error(`文件不存在: ${asset.path}`);

  const bins = await detectBins();
  const meta: Record<string, unknown> = { ffmpeg: bins.available };
  const updates: Record<string, SQLQueryBindings> = {};

  if (!bins.available || !bins.ffprobe || !bins.ffmpeg) {
    meta.note = "未检测到 ffmpeg/ffprobe，跳过元数据探测与缩略图";
    db.run("UPDATE assets SET metaJson = ? WHERE id = ?", [JSON.stringify(meta), assetId]);
    ctx.progress(1, "已入库（无 ffmpeg，未生成缩略图）");
    broadcastAsset(getAsset(assetId)!);
    return { degraded: true };
  }

  // 1. 探测元数据
  ctx.progress(0.1, "探测元数据");
  if (asset.type === "video" || asset.type === "audio" || asset.type === "image") {
    const info = await probe(bins.ffprobe, abs);
    if (info) {
      updates.durationMs = info.durationMs;
      updates.width = info.width;
      updates.height = info.height;
      meta.videoCodec = info.videoCodec;
      meta.audioCodec = info.audioCodec;
      meta.bitRate = info.bitRate;
    }
  }

  // 2. 缩略图 / 波形
  ctx.progress(0.35, "生成缩略图");
  const thumb = thumbAbs(assetId);
  try {
    if (asset.type === "video") {
      mkdirSync(dirname(thumb), { recursive: true });
      const at = typeof updates.durationMs === "number" ? Math.min(1000, updates.durationMs / 2) : 0;
      await videoThumbnail(bins.ffmpeg, abs, thumb, at, ctx.signal);
      updates.thumbPath = `.cache/thumb/${assetId}.jpg`;
    } else if (asset.type === "image") {
      mkdirSync(dirname(thumb), { recursive: true });
      await imageThumbnail(bins.ffmpeg, abs, thumb, ctx.signal);
      updates.thumbPath = `.cache/thumb/${assetId}.jpg`;
    } else if (asset.type === "audio") {
      mkdirSync(dirname(thumb), { recursive: true });
      await audioWaveform(bins.ffmpeg, abs, thumb, ctx.signal);
      updates.thumbPath = `.cache/thumb/${assetId}.jpg`;
    }
  } catch (e) {
    meta.thumbError = e instanceof Error ? e.message : String(e);
  }

  // 3. 视频代理（720p）
  if (asset.type === "video") {
    ctx.progress(0.5, "生成代理");
    const proxy = proxyAbs(assetId);
    try {
      mkdirSync(dirname(proxy), { recursive: true });
      await videoProxy(
        bins.ffmpeg,
        abs,
        proxy,
        (updates.durationMs as number | null) ?? null,
        (r) => ctx.progress(0.5 + r * 0.45, "生成代理"),
        ctx.signal,
      );
      updates.proxyPath = `.cache/proxy/${assetId}.mp4`;
    } catch (e) {
      if (e instanceof Error && e.name === "CanceledError") throw e;
      meta.proxyError = e instanceof Error ? e.message : String(e);
    }
  }

  // 4. 落库
  const keys = Object.keys(updates);
  if (keys.length > 0) {
    db.run(
      `UPDATE assets SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`,
      [...keys.map((k) => updates[k]!), assetId],
    );
  }
  db.run("UPDATE assets SET metaJson = ? WHERE id = ?", [JSON.stringify(meta), assetId]);

  ctx.progress(1, "索引完成");
  broadcastAsset(getAsset(assetId)!);
  return { thumb: !!updates.thumbPath, proxy: !!updates.proxyPath };
};
