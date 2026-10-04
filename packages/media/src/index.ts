/**
 * @vw/media —— ffmpeg/ffprobe 封装。
 * 检测顺序：环境变量 → 项目自带(ffmpeg-static) → PATH → 常见安装位置。
 * 自带优先，换机器不用装 ffmpeg。
 */

/// <reference path="./types.d.ts" />
import { existsSync } from "node:fs";
import { join } from "node:path";
import ffmpegStaticPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

export * from "./timeline";

export interface MediaBins {
  ffmpeg: string | null;
  ffprobe: string | null;
  /** "env" | "path" | "common" | "bundled" | "none" */
  source: "env" | "path" | "common" | "bundled" | "none";
  available: boolean;
}

let cached: MediaBins | null = null;

async function whichOk(name: string): Promise<string | null> {
  try {
    const proc = Bun.spawnSync(["/usr/bin/which", name], { stdout: "pipe", stderr: "ignore" });
    const out = proc.stdout.toString().trim();
    return proc.exitCode === 0 && out ? out : null;
  } catch {
    return null;
  }
}

export async function detectBins(force = false): Promise<MediaBins> {
  if (cached && !force) return cached;

  const envFfmpeg = process.env.VW_FFMPEG;
  const envFfprobe = process.env.VW_FFPROBE;
  if (envFfmpeg && existsSync(envFfmpeg)) {
    cached = {
      ffmpeg: envFfmpeg,
      ffprobe: envFfprobe && existsSync(envFfprobe) ? envFfprobe : null,
      source: "env",
      available: true,
    };
    return cached;
  }

  // 项目自带优先：换机器不用装 ffmpeg
  const bundledFfmpeg = ffmpegStaticPath && existsSync(ffmpegStaticPath) ? ffmpegStaticPath : null;
  const bundledFfprobe = ffprobeStatic.path && existsSync(ffprobeStatic.path) ? ffprobeStatic.path : null;
  if (bundledFfmpeg) {
    cached = { ffmpeg: bundledFfmpeg, ffprobe: bundledFfprobe, source: "bundled", available: true };
    return cached;
  }

  const [pathFfmpeg, pathFfprobe] = await Promise.all([whichOk("ffmpeg"), whichOk("ffprobe")]);
  if (pathFfmpeg) {
    cached = { ffmpeg: pathFfmpeg, ffprobe: pathFfprobe, source: "path", available: true };
    return cached;
  }

  const commonDirs = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];
  const foundFfmpeg = commonDirs.map((d) => join(d, "ffmpeg")).find((p) => existsSync(p)) ?? null;
  const foundFfprobe = commonDirs.map((d) => join(d, "ffprobe")).find((p) => existsSync(p)) ?? null;
  if (foundFfmpeg) {
    cached = { ffmpeg: foundFfmpeg, ffprobe: foundFfprobe, source: "common", available: true };
    return cached;
  }

  cached = { ffmpeg: null, ffprobe: null, source: "none", available: false };
  return cached;
}

// ---------------------------------------------------------------------------
// ffprobe
// ---------------------------------------------------------------------------

export interface ProbeResult {
  durationMs: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  bitRate: number | null;
}

export async function probe(ffprobeBin: string, file: string): Promise<ProbeResult | null> {
  try {
    const proc = Bun.spawnSync(
      [ffprobeBin, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", file],
      { stdout: "pipe", stderr: "ignore" },
    );
    if (proc.exitCode !== 0) return null;
    const json = JSON.parse(proc.stdout.toString()) as {
      format?: { duration?: string; bit_rate?: string };
      streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }>;
    };
    const streams = json.streams ?? [];
    const video = streams.find((s) => s.codec_type === "video");
    const audio = streams.find((s) => s.codec_type === "audio");
    const durationSec = json.format?.duration ? Number(json.format.duration) : NaN;
    return {
      durationMs: Number.isFinite(durationSec) ? Math.round(durationSec * 1000) : null,
      width: video?.width ?? null,
      height: video?.height ?? null,
      videoCodec: video?.codec_name ?? null,
      audioCodec: audio?.codec_name ?? null,
      bitRate: json.format?.bit_rate ? Number(json.format.bit_rate) : null,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ffmpeg 执行（带进度与取消）
// ---------------------------------------------------------------------------

export class CanceledError extends Error {
  constructor() {
    super("已取消");
    this.name = "CanceledError";
  }
}

function parseTimeMs(line: string): number | null {
  const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);
  if (!m) return null;
  return (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000;
}

export async function runFfmpeg(opts: {
  bin: string;
  args: string[];
  /** 总时长（用于进度换算），未知传 null */
  durationMs?: number | null;
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const { bin, args, durationMs, onProgress, signal } = opts;
  const proc = Bun.spawn([bin, "-hide_banner", "-y", ...args], {
    stdout: "ignore",
    stderr: "pipe",
  });

  const onAbort = () => {
    try {
      proc.kill();
    } catch {
      /* 已退出 */
    }
  };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }

  let lastReported = -1;
  const reader = proc.stderr.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split(/[\r\n]+/);
    buf = lines.pop() ?? "";
    if (onProgress && durationMs && durationMs > 0) {
      for (const line of lines) {
        const t = parseTimeMs(line);
        if (t !== null) {
          const ratio = Math.min(0.99, t / durationMs);
          if (ratio - lastReported >= 0.02) {
            lastReported = ratio;
            onProgress(ratio);
          }
        }
      }
    }
  }

  const code = await proc.exited;
  if (signal) signal.removeEventListener("abort", onAbort);
  if (signal?.aborted) throw new CanceledError();
  if (code !== 0) throw new Error(`ffmpeg 退出码 ${code}`);
}

// ---------------------------------------------------------------------------
// 常用操作
// ---------------------------------------------------------------------------

/** 视频抽帧缩略图（jpg，宽 640 内） */
export async function videoThumbnail(bin: string, input: string, output: string, atMs: number, signal?: AbortSignal) {
  const atSec = Math.max(0, atMs / 1000).toFixed(2);
  await runFfmpeg({
    bin,
    args: ["-ss", atSec, "-i", input, "-frames:v", "1", "-vf", "scale='min(640,iw)':-2", "-q:v", "4", output],
    signal,
  });
}

/** 图片缩略图（jpg，宽 640 内） */
export async function imageThumbnail(bin: string, input: string, output: string, signal?: AbortSignal) {
  await runFfmpeg({
    bin,
    args: ["-i", input, "-frames:v", "1", "-vf", "scale='min(640,iw)':-2", "-q:v", "4", output],
    signal,
  });
}

/** 音频波形图（png 640x360） */
export async function audioWaveform(bin: string, input: string, output: string, signal?: AbortSignal) {
  await runFfmpeg({
    bin,
    args: ["-i", input, "-filter_complex", "showwavespic=s=640x360:split_channels=0", "-frames:v", "1", output],
    signal,
  });
}

/** 抽出单声道音频，分析转写用。 */
export async function extractAudio(
  bin: string,
  input: string,
  output: string,
  opts?: { maxSec?: number; signal?: AbortSignal },
) {
  const args = ["-i", input, "-vn", "-ac", "1", "-ar", "16000"];
  if (opts?.maxSec && opts.maxSec > 0) args.push("-t", String(opts.maxSec));
  args.push(output);
  await runFfmpeg({ bin, args, signal: opts?.signal });
}

/** 暖米黄纸底静帧。白板动画用，换机器不依赖本机 Python。 */
export async function paperStill(
  bin: string,
  output: string,
  opts?: { color?: string; width?: number; height?: number; signal?: AbortSignal },
) {
  const color = (opts?.color ?? "#F5EBD7").replace(/^#/, "0x");
  const w = opts?.width ?? 1280;
  const h = opts?.height ?? 720;
  await runFfmpeg({
    bin,
    args: ["-f", "lavfi", "-i", `color=c=${color}:s=${w}x${h}:d=1`, "-frames:v", "1", output],
    signal: opts?.signal,
  });
}

/** 检测 ffmpeg 是否支持 subtitles 滤镜（libass，字幕烧录用） */
export async function hasSubtitlesFilter(bin: string): Promise<boolean> {
  try {
    const proc = Bun.spawnSync([bin, "-hide_banner", "-filters"], { stdout: "pipe", stderr: "ignore" });
    return proc.stdout.toString().includes("subtitles");
  } catch {
    return false;
  }
}

/** 任意素材转成可预览的 mp4（画布 ffmpeg 节点用） */
export async function transcodeMp4(
  bin: string,
  input: string,
  output: string,
  opts?: { signal?: AbortSignal; durationMs?: number },
) {
  await runFfmpeg({
    bin,
    args: [
      "-i", input,
      "-vf", "scale=-2:'min(720,ih)'",
      "-c:v", "libx264", "-crf", "23", "-preset", "veryfast",
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart",
      output,
    ],
    durationMs: opts?.durationMs,
    signal: opts?.signal,
  });
}

/** 视频代理（720p h264 + aac，faststart），进度 0-1 */
export async function videoProxy(
  bin: string,
  input: string,
  output: string,
  durationMs: number | null,
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
) {
  await runFfmpeg({
    bin,
    args: [
      "-i", input,
      "-vf", "scale=-2:'min(720,ih)'",
      "-c:v", "libx264", "-crf", "28", "-preset", "veryfast",
      "-c:a", "aac", "-b:a", "96k",
      "-movflags", "+faststart",
      output,
    ],
    durationMs,
    onProgress,
    signal,
  });
}
