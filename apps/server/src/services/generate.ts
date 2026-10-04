import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { clipDuration, type TimelineDoc } from "@vw/core";
import { getAdapter } from "@vw/models";
import { detectBins, probe } from "@vw/media";
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
