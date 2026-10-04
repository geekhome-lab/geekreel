/**
 * 时间线 → ffmpeg filter_complex 渲染。
 * buildRenderPlan 是纯函数（可测），executeRender 负责执行与进度。
 */

import { clipDuration, clipSpeed, subtitleTrack, timelineDuration, type TimelineClip, type TimelineDoc } from "@vw/core";
import { runFfmpeg } from "./index";

export interface RenderAssetInfo {
  absPath: string;
  hasAudio: boolean;
  /** 静帧图片：循环铺满片段时长 */
  isStill: boolean;
}

export interface RenderPlan {
  args: string[];
  outputDurationMs: number;
  videoClipCount: number;
  audioInputCount: number;
  subtitles: "burn" | "soft" | "none";
}

function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

function fadeFilter(c: TimelineClip, durSec: number): string {
  if (c.transition !== "fade" || durSec <= 0.08) return "";
  const d = Math.min((c.transitionMs ?? 400) / 1000, durSec / 2);
  return `,fade=t=in:st=0:d=${d.toFixed(3)},fade=t=out:st=${Math.max(0, durSec - d).toFixed(3)}:d=${d.toFixed(3)}`;
}

/** atempo 只接受 0.5–2，超出就串起来 */
function atempoChain(speed: number): string {
  const parts: string[] = [];
  let s = speed;
  while (s > 2.0001) {
    parts.push("atempo=2.0");
    s /= 2;
  }
  while (s < 0.499) {
    parts.push("atempo=0.5");
    s /= 0.5;
  }
  parts.push(`atempo=${s.toFixed(3)}`);
  return parts.join(",");
}

/**
 * 构建渲染计划。
 * @param doc 时间线文档
 * @param assets assetId → 文件信息
 * @param opts srtPath: 字幕文件（有字幕时必传）；burnSubs: 是否烧录（false 则软封装 mov_text）
 */
export function buildRenderPlan(
  doc: TimelineDoc,
  assets: Map<string, RenderAssetInfo>,
  opts: { srtPath?: string; burnSubs: boolean; outPath: string },
): RenderPlan {
  const W = doc.width;
  const H = doc.height;

  const vTrack = doc.tracks.find((t) => t.type === "video");
  if (!vTrack || vTrack.clips.length === 0) throw new Error("时间线为空：视频轨没有片段");

  const vClips = [...vTrack.clips].sort((a, b) => a.startMs - b.startMs);
  for (const c of vClips) {
    if (!c.assetId || !assets.has(c.assetId)) throw new Error("有片段引用的资产不存在");
    if (c.outMs <= c.inMs) throw new Error("有片段的出入点不合法");
  }

  // 输入去重
  const assetIds: string[] = [];
  const needInput = (id: string): number => {
    let i = assetIds.indexOf(id);
    if (i < 0) {
      assetIds.push(id);
      i = assetIds.length - 1;
    }
    return i;
  };

  const filters: string[] = [];

  // ---- 视频链：trim → 变速 → 统一画布 → 淡入淡出 → concat ----
  vClips.forEach((c, i) => {
    const k = needInput(c.assetId!);
    const info = assets.get(c.assetId!)!;
    const speed = clipSpeed(c);
    const durSec = clipDuration(c) / 1000;
    const fade = fadeFilter(c, durSec);
    const scalePad =
      `scale=${W}:${H}:force_original_aspect_ratio=decrease:force_divisible_by=2,` +
      `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1`;
    if (info.isStill) {
      const dur = durSec.toFixed(3);
      filters.push(`[${k}:v]fps=30,trim=duration=${dur},setpts=PTS-STARTPTS,${scalePad}${fade}[v${i}]`);
    } else {
      const inS = (c.inMs / 1000).toFixed(3);
      const outS = (c.outMs / 1000).toFixed(3);
      const pts = speed === 1 ? "setpts=PTS-STARTPTS" : `setpts=(PTS-STARTPTS)/${speed}`;
      filters.push(`[${k}:v]trim=start=${inS}:end=${outS},${pts},${scalePad}${fade}[v${i}]`);
    }
  });
  filters.push(`${vClips.map((_, i) => `[v${i}]`).join("")}concat=n=${vClips.length}:v=1:a=0[vcat]`);

  // ---- 字幕 ----
  const cues = subtitleTrack(doc)?.clips.filter((c) => c.text?.trim()) ?? [];
  let vout = "vcat";
  let subtitles: RenderPlan["subtitles"] = "none";
  if (cues.length > 0 && opts.srtPath) {
    if (opts.burnSubs) {
      filters.push(`[vcat]subtitles='${escapeFilterPath(opts.srtPath)}'[vsub]`);
      vout = "vsub";
      subtitles = "burn";
    } else {
      subtitles = "soft";
    }
  }

  // ---- 音频链 ----
  const audioLabels: string[] = [];

  // 视频片段自带音频（随画面顺序拼接）
  const vaClips = vClips.filter((c) => (c.volume ?? 1) > 0 && assets.get(c.assetId!)?.hasAudio);
  vaClips.forEach((c, i) => {
    const k = needInput(c.assetId!);
    const speed = clipSpeed(c);
    const tempo = speed === 1 ? "" : `,${atempoChain(speed)}`;
    filters.push(
      `[${k}:a]atrim=start=${(c.inMs / 1000).toFixed(3)}:end=${(c.outMs / 1000).toFixed(3)},` +
        `asetpts=PTS-STARTPTS${tempo},volume=${(c.volume ?? 1).toFixed(2)}[va${i}]`,
    );
  });
  if (vaClips.length === 1) {
    filters.push(`[va0]anull[vacat]`);
  } else if (vaClips.length > 1) {
    filters.push(`${vaClips.map((_, i) => `[va${i}]`).join("")}concat=n=${vaClips.length}:v=0:a=1[vacat]`);
  }
  if (vaClips.length > 0) audioLabels.push("vacat");

  // 音频轨（按 startMs 定位）
  let ai = 0;
  for (const track of doc.tracks.filter((t) => t.type === "audio")) {
    for (const c of [...track.clips].sort((a, b) => a.startMs - b.startMs)) {
      if (!c.assetId || !assets.has(c.assetId)) throw new Error("音频片段引用的资产不存在");
      const k = needInput(c.assetId!);
      const delay = Math.max(0, Math.round(c.startMs));
      const speed = clipSpeed(c);
      const tempo = speed === 1 ? "" : `,${atempoChain(speed)}`;
      filters.push(
        `[${k}:a]atrim=start=${(c.inMs / 1000).toFixed(3)}:end=${(c.outMs / 1000).toFixed(3)},` +
          `asetpts=PTS-STARTPTS${tempo},volume=${(c.volume ?? 1).toFixed(2)},adelay=${delay}|${delay}[ta${ai}]`,
      );
      audioLabels.push(`ta${ai}`);
      ai++;
    }
  }

  let aout: string | null = null;
  if (audioLabels.length === 1) {
    filters.push(`[${audioLabels[0]}]anull[aout]`);
    aout = "aout";
  } else if (audioLabels.length > 1) {
    filters.push(`${audioLabels.map((l) => `[${l}]`).join("")}amix=inputs=${audioLabels.length}:duration=longest:normalize=0[aout]`);
    aout = "aout";
  }

  // ---- 组装参数 ----
  const args: string[] = [];
  for (const id of assetIds) {
    const info = assets.get(id)!;
    if (info.isStill) args.push("-loop", "1", "-framerate", "30");
    args.push("-i", info.absPath);
  }
  // 软字幕：SRT 作为额外输入
  let srtInputIndex = -1;
  if (subtitles === "soft" && opts.srtPath) {
    srtInputIndex = assetIds.length;
    args.push("-i", opts.srtPath);
  }

  args.push("-filter_complex", filters.join(";"));
  args.push("-map", `[${vout}]`);
  if (aout) args.push("-map", `[${aout}]`);
  if (srtInputIndex >= 0) args.push("-map", `${srtInputIndex}:s`);
  args.push("-c:v", "libx264", "-crf", "20", "-preset", "veryfast", "-pix_fmt", "yuv420p");
  if (aout) args.push("-c:a", "aac", "-b:a", "160k");
  if (srtInputIndex >= 0) args.push("-c:s", "mov_text");
  // 静帧 -loop 1 是无限输入，用输出时长兜底防止挂死
  args.push("-t", (timelineDuration(doc) / 1000).toFixed(3));
  args.push("-movflags", "+faststart", opts.outPath);

  return {
    args,
    outputDurationMs: timelineDuration(doc),
    videoClipCount: vClips.length,
    audioInputCount: audioLabels.length,
    subtitles,
  };
}

export async function executeRender(
  bin: string,
  plan: RenderPlan,
  onProgress: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  await runFfmpeg({ bin, args: plan.args, durationMs: plan.outputDurationMs, onProgress, signal });
}
