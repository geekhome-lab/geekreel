/**
 * @vw/core —— 前后端共享的领域类型与纯函数。
 * 不依赖任何运行时 API（Node/Bun/浏览器均可引入）。
 */

import type { PushLog, RadarItem } from "./radar";
export * from "./timeline";
export * from "./radar";
export * from "./analyze";
export * from "./style";

// ---------------------------------------------------------------------------
// 资产
// ---------------------------------------------------------------------------

export type AssetType = "image" | "video" | "audio" | "text";

export const assetTypes: AssetType[] = ["image", "video", "audio", "text"];

export const assetTypeLabels: Record<AssetType, string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
  text: "文本",
};

export type AssetSource = "import" | "canvas" | "pipeline" | "remake" | "analyze";

export const assetSourceLabels: Record<AssetSource, string> = {
  import: "导入",
  canvas: "画布生成",
  pipeline: "流水线产出",
  remake: "复刻产出",
  analyze: "分析下载",
};

export interface Asset {
  id: string;
  type: AssetType;
  /** 资产库内相对路径，如 image/2026-10/1004_武松打虎_a3f2.png */
  path: string;
  /** 文件名（含扩展名） */
  name: string;
  /** 展示标题（可重命名，同步改文件名） */
  title: string;
  source: AssetSource;
  projectId: string | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  sizeBytes: number;
  thumbPath: string | null;
  proxyPath: string | null;
  metaJson: string;
  createdAt: number;
}

const extTypeMap: Record<string, AssetType> = {
  png: "image", jpg: "image", jpeg: "image", webp: "image", gif: "image", bmp: "image", svg: "image", avif: "image",
  mp4: "video", mov: "video", mkv: "video", webm: "video", avi: "video", m4v: "video", flv: "video", ts: "video",
  mp3: "audio", wav: "audio", m4a: "audio", aac: "audio", flac: "audio", ogg: "audio", opus: "audio",
  md: "text", txt: "text", srt: "text", json: "text", vtt: "text",
};

export function assetTypeFromExt(ext: string): AssetType | null {
  return extTypeMap[ext.toLowerCase()] ?? null;
}

export function extFromFileName(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

const mimeMap: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  bmp: "image/bmp", svg: "image/svg+xml", avif: "image/avif",
  mp4: "video/mp4", mov: "video/quicktime", mkv: "video/x-matroska", webm: "video/webm",
  avi: "video/x-msvideo", m4v: "video/x-m4v", flv: "video/x-flv", ts: "video/mp2t",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac",
  ogg: "audio/ogg", opus: "audio/ogg",
  md: "text/markdown; charset=utf-8", txt: "text/plain; charset=utf-8",
  srt: "text/plain; charset=utf-8", json: "application/json; charset=utf-8", vtt: "text/vtt; charset=utf-8",
};

export function mimeFromExt(ext: string): string {
  return mimeMap[ext.toLowerCase()] ?? "application/octet-stream";
}

/** 清洗标题为文件名片段：去非法字符、压缩空白、截断。 */
export function sanitizeTitle(raw: string, max = 40): string {
  const cleaned = raw
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const sliced = Array.from(cleaned).slice(0, max).join("");
  return sliced || "未命名";
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * 资产库存放规范：{type}/{yyyy}-{mm}/{mmdd}_{标题}_{id前4位}.{ext}
 * 例：image/2026-10/1004_武松打虎-角色三视图_a3f2.png
 */
export function buildAssetRelPath(opts: {
  type: AssetType;
  title: string;
  id: string;
  ext: string;
  date?: Date;
}): string {
  const d = opts.date ?? new Date();
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hash = opts.id.replace(/-/g, "").slice(0, 4);
  const title = sanitizeTitle(opts.title);
  return `${opts.type}/${yyyy}-${mm}/${mm}${dd}_${title}_${hash}.${opts.ext}`;
}

/** 从规范文件名中解析（重命名时用）：1004_标题_a3f2.png */
export function parseAssetFileName(name: string): { mmdd: string; title: string; hash: string; ext: string } | null {
  const m = /^(\d{4})_(.+)_([0-9a-f]{4})\.([a-z0-9]+)$/i.exec(name);
  if (!m) return null;
  return { mmdd: m[1]!, title: m[2]!, hash: m[3]!, ext: m[4]! };
}

// ---------------------------------------------------------------------------
// 项目
// ---------------------------------------------------------------------------

export interface Project {
  id: string;
  name: string;
  directory: string;
  coverAssetId: string | null;
  stylePackId: string | null;
  paletteJson: string | null;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// 任务
// ---------------------------------------------------------------------------

export type JobStatus = "queued" | "running" | "done" | "failed" | "canceled";

export const jobStatusLabels: Record<JobStatus, string> = {
  queued: "排队中",
  running: "运行中",
  done: "已完成",
  failed: "失败",
  canceled: "已取消",
};

export interface Job {
  id: string;
  projectId: string | null;
  type: string;
  status: JobStatus;
  /** 0-1 */
  progress: number;
  message: string | null;
  payloadJson: string;
  resultJson: string | null;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export const jobTypeLabels: Record<string, string> = {
  "asset.index": "资产索引",
  "asset.migrate": "资产迁移",
  "media.transcode": "转码",
  "gen.image": "文生图",
  "gen.video": "视频生成",
  "gen.tts": "语音合成",
  "timeline.render": "时间线导出",
  "radar.fetch": "雷达取热点",
  "radar.digest": "雷达早报",
  "analyze.run": "竞品分析",
  "remake.run": "爆款复刻",
  "pipeline.run": "风格流水线",
};

// ---------------------------------------------------------------------------
// API 与 WS 事件
// ---------------------------------------------------------------------------

export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = { ok: false; error: string };
export type ApiResp<T> = ApiOk<T> | ApiErr;

export type WsEvent =
  | { type: "hello"; now: number }
  | { type: "job.upsert"; job: Job }
  | { type: "asset.upsert"; asset: Asset }
  | { type: "asset.remove"; id: string }
  | { type: "radar.upsert"; item: RadarItem }
  | { type: "push.log"; log: PushLog };

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

export interface PublicSettings {
  libraryRoot: string;
  dataDir: string;
  version: string;
  ffmpeg: { available: boolean; source: string; ffmpeg: string | null; ffprobe: string | null };
  assetCount: number;
}
