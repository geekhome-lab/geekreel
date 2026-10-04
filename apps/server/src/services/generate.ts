import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { clipDuration, type TimelineDoc } from "@vw/core";
import { getAdapter } from "@vw/models";
import { detectBins, probe, transcodeMp4, videoThumbnail } from "@vw/media";
import { db } from "../db";
import type { JobHandler } from "../jobs/queue";
import { resolveEndpoint } from "./models";
import { absInLibrary, storeAsset } from "./library";
import { recordUsage } from "./usage";

/**
 * gen.image：文生图任务。
 * payload: { prompt, size?, endpointId?, projectId? }
 * result: { assetId }
 */
export const genImageHandler: JobHandler = async (job, ctx) => {
  const payload = JSON.parse(job.payloadJson) as {
    prompt: string;
    size?: string;
    endpointId?: string;
    projectId?: string;
  };
  if (!payload.prompt?.trim()) throw new Error("缺少提示词");

  ctx.progress(0.05, "解析模型端点");
  const endpoint = resolveEndpoint("image", payload.endpointId);
  if (!endpoint) throw new Error("未配置图片模型端点，请先到「模型」页添加");
  const adapter = getAdapter(endpoint.adapterType);
  if (!adapter?.generateImage) throw new Error(`适配器 ${endpoint.adapterType} 不支持图片生成`);

  ctx.progress(0.15, `调用 ${endpoint.name}`);
  const result = await adapter.generateImage(endpoint.config, {
    prompt: payload.prompt,
    size: payload.size,
    signal: ctx.signal,
  });

  ctx.progress(0.85, "产物入库");
  const title = payload.prompt.replace(/\s+/g, " ").slice(0, 24);
  const asset = storeAsset({
    type: "image",
    title: title || "生成图片",
    ext: "png",
    source: "canvas",
    projectId: payload.projectId ?? job.projectId,
    data: result.data,
  });
  recordUsage({
    endpoint,
    projectId: payload.projectId ?? job.projectId,
    jobType: "gen.image",
    images: 1,
  });

  ctx.progress(1, "生成完成");
  return { assetId: asset.id, endpointId: endpoint.id };
};

export const genTtsHandler: JobHandler = async (job, ctx) => {
  const payload = JSON.parse(job.payloadJson) as {
    text: string;
    endpointId?: string;
    projectId?: string;
  };
  const text = payload.text?.trim();
  if (!text) throw new Error("先写要说的话");

  ctx.progress(0.08, "找语音模型");
  const endpoint = resolveEndpoint("tts", payload.endpointId);
  if (!endpoint) throw new Error("还没有语音模型。到「模型」页加一个 OpenAI 兼容的配音端点，模型名一般是 tts-1。");
  const adapter = getAdapter(endpoint.adapterType);
  if (!adapter?.generateSpeech) throw new Error("这个模型不会配音，换一个语音模型");

  ctx.progress(0.25, `正在配音 ${endpoint.name}`);
  const speech = await adapter.generateSpeech(endpoint.config, { text, signal: ctx.signal });
  const ext = speech.mime.includes("wav") ? "wav" : "mp3";
  const asset = storeAsset({
    type: "audio",
    title: text.slice(0, 20) || "配音",
    ext,
    source: "tts",
    projectId: payload.projectId ?? job.projectId,
    data: speech.data,
  });
  recordUsage({
    endpoint,
    projectId: payload.projectId ?? job.projectId,
    jobType: "gen.tts",
    audioChars: text.length,
  });

  let durationMs: number | null = null;
  try {
    const bins = await detectBins();
    if (bins.ffprobe) {
      const info = await probe(bins.ffprobe, absInLibrary(asset.path));
      durationMs = info?.durationMs ?? null;
      if (durationMs) {
        db.run("UPDATE assets SET durationMs = ? WHERE id = ?", [durationMs, asset.id]);
      }
    }
  } catch {
    /* 时长探测失败不影响配音 */
  }

  ctx.progress(1, "配音完成");
  return { assetId: asset.id, endpointId: endpoint.id, durationMs };
};

export const timelineTtsHandler: JobHandler = async (job, ctx) => {
  const payload = JSON.parse(job.payloadJson) as { projectId?: string; endpointId?: string };
  if (!payload.projectId) throw new Error("缺少项目");
  const project = db.query("SELECT directory FROM projects WHERE id = ?").get(payload.projectId) as { directory: string } | null;
  if (!project) throw new Error("项目不存在");
  const abs = join(project.directory, "timeline", "main.json");
  if (!existsSync(abs)) throw new Error("时间线还是空的。先贴字幕或从画布装上。");
  const doc = JSON.parse(readFileSync(abs, "utf-8")) as TimelineDoc;
  const subs = doc.tracks.find((t) => t.type === "subtitle")?.clips.filter((c) => c.text?.trim()) ?? [];
  if (subs.length === 0) throw new Error("没有字幕。先导入 SRT 或点「加字幕」。");

  const endpoint = resolveEndpoint("tts", payload.endpointId);
  if (!endpoint) throw new Error("还没有语音模型。到「模型」页加一个，模型名一般是 tts-1。");
  const adapter = getAdapter(endpoint.adapterType);
  if (!adapter?.generateSpeech) throw new Error("这个模型不会配音");

  let aTrack = doc.tracks.find((t) => t.type === "audio");
  if (!aTrack) {
    aTrack = { id: "a1", type: "audio", name: "音频 1", clips: [] };
    doc.tracks.push(aTrack);
  }

  const bins = await detectBins();
  let done = 0;
  for (const sub of subs) {
    ctx.progress(0.1 + (done / subs.length) * 0.8, `配音 ${done + 1}/${subs.length}`);
    const speech = await adapter.generateSpeech(endpoint.config, { text: sub.text!.trim(), signal: ctx.signal });
    const ext = speech.mime.includes("wav") ? "wav" : "mp3";
    const asset = storeAsset({
      type: "audio",
      title: sub.text!.trim().slice(0, 20) || "配音",
      ext,
      source: "tts",
      projectId: payload.projectId,
      data: speech.data,
    });
    let dur = clipDuration(sub);
    if (bins.ffprobe) {
      try {
        const info = await probe(bins.ffprobe, absInLibrary(asset.path));
        if (info?.durationMs) {
          dur = info.durationMs;
          db.run("UPDATE assets SET durationMs = ? WHERE id = ?", [dur, asset.id]);
        }
      } catch {
        /* 用字幕时长 */
      }
    }
    aTrack.clips.push({
      id: `c_tts_${done}`,
      assetId: asset.id,
      startMs: sub.startMs,
      inMs: 0,
      outMs: Math.max(400, dur),
      volume: 1,
    });
    recordUsage({
      endpoint,
      projectId: payload.projectId,
      jobType: "timeline.tts",
      audioChars: sub.text!.trim().length,
    });
    done++;
  }

  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, JSON.stringify(doc, null, 2));
  ctx.progress(1, `已配 ${done} 段`);
  return { clipCount: done, projectId: payload.projectId };
};

export const genVideoHandler: JobHandler = async (job, ctx) => {
  const payload = JSON.parse(job.payloadJson) as {
    prompt: string;
    durationSec?: number;
    endpointId?: string;
    projectId?: string;
  };
  if (!payload.prompt?.trim()) throw new Error("缺少提示词");
  ctx.progress(0.05, "找视频模型");
  const endpoint = resolveEndpoint("video", payload.endpointId);
  if (!endpoint) throw new Error("还没有视频模型。到「模型」页加可灵、豆包或 OpenAI 兼容的视频端点。");
  const adapter = getAdapter(endpoint.adapterType);
  if (!adapter?.generateVideo) throw new Error("这个模型不会出视频，换一个视频模型");

  ctx.progress(0.15, `正在生成 ${endpoint.name}，可能要一两分钟`);
  const result = await adapter.generateVideo(endpoint.config, {
    prompt: payload.prompt,
    durationSec: payload.durationSec || 5,
    signal: ctx.signal,
  });
  const ext = result.mime.includes("webm") ? "webm" : "mp4";
  const asset = storeAsset({
    type: "video",
    title: payload.prompt.replace(/\s+/g, " ").slice(0, 24) || "生成视频",
    ext,
    source: "canvas",
    projectId: payload.projectId ?? job.projectId,
    data: result.data,
  });
  recordUsage({
    endpoint,
    projectId: payload.projectId ?? job.projectId,
    jobType: "gen.video",
    videoSec: result.durationSec ?? payload.durationSec ?? 5,
  });
  ctx.progress(1, "视频已入库");
  return { assetId: asset.id, endpointId: endpoint.id };
};

export const mediaTranscodeHandler: JobHandler = async (job, ctx) => {
  const payload = JSON.parse(job.payloadJson) as {
    op?: "extract" | "transcode";
    assetId?: string;
    atMs?: number;
    projectId?: string;
  };
  if (!payload.assetId) throw new Error("先选一段素材");
  const src = db.query("SELECT * FROM assets WHERE id = ?").get(payload.assetId) as { id: string; path: string; title: string; type: string } | null;
  if (!src) throw new Error("素材不存在");
  const bins = await detectBins();
  if (!bins.ffmpeg) throw new Error("项目自带的 ffmpeg 找不到。把整个项目拷走再试。");

  const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const tmp = mkdtempSync(join(tmpdir(), "vw-ff-"));
  try {
    const input = absInLibrary(src.path);
    if (payload.op === "extract") {
      ctx.progress(0.2, "抽一帧");
      const out = join(tmp, "frame.jpg");
      await videoThumbnail(bins.ffmpeg, input, out, payload.atMs ?? 1000, ctx.signal);
      const asset = storeAsset({
        type: "image",
        title: `${src.title}-抽帧`,
        ext: "jpg",
        source: "canvas",
        projectId: payload.projectId ?? job.projectId,
        data: readFileSync(out),
      });
      ctx.progress(1, "抽帧完成");
      return { assetId: asset.id };
    }
    ctx.progress(0.2, "转码");
    const out = join(tmp, "out.mp4");
    await transcodeMp4(bins.ffmpeg, input, out, { signal: ctx.signal });
    const asset = storeAsset({
      type: "video",
      title: `${src.title}-转码`,
      ext: "mp4",
      source: "canvas",
      projectId: payload.projectId ?? job.projectId,
      data: readFileSync(out),
    });
    ctx.progress(1, "转码完成");
    return { assetId: asset.id };
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* 临时目录清不掉不影响产物 */
    }
  }
};
