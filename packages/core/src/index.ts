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

export type AssetKind = "generic" | "character" | "scene" | "prop";

export const assetKinds: AssetKind[] = ["generic", "character", "scene", "prop"];

export const assetKindLabels: Record<AssetKind, string> = {
  generic: "通用",
  character: "角色",
  scene: "场景",
  prop: "道具",
};

export type AssetSource = "import" | "canvas" | "pipeline" | "remake" | "analyze" | "tts";

export const assetSourceLabels: Record<AssetSource, string> = {
  import: "导入",
  canvas: "画布生成",
  pipeline: "流水线产出",
  remake: "复刻产出",
  analyze: "分析下载",
  tts: "配音",
};

export interface Asset {
  id: string;
  type: AssetType;
  /** 资产库内相对路径，如 works/倩女幽魂/第01集/image_聂小倩_a3f2.png */
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
  favorite: boolean;
  kind: AssetKind;
  tags: string[];
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

/**
 * 资产按作品收：works/作品名/ 或 works/作品名/第01集/
 * 没有作品时进 works/未归类/
 */
export function buildAssetRelPath(opts: {
  type: AssetType;
  title: string;
  id: string;
  ext: string;
  date?: Date;
  workFolder?: string;
}): string {
  const hash = opts.id.replace(/-/g, "").slice(0, 4);
  const title = sanitizeTitle(opts.title);
  const name = `${opts.type}_${title}_${hash}.${opts.ext}`;
  const folder = (opts.workFolder ?? "works/未归类").replace(/^\/+|\/+$/g, "");
  return `${folder}/${name}`;
}

/** 从路径抽出作品夹，用于资产库分组。 */
export function assetWorkFolder(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "works") {
    if (parts.length >= 3 && /^第\d+集$/.test(parts[2] ?? "")) return parts.slice(0, 3).join("/");
    if (parts.length >= 2) return parts.slice(0, 2).join("/");
    return "works/未归类";
  }
  if (parts[0] === "image" || parts[0] === "video" || parts[0] === "audio" || parts[0] === "text") {
    return `未归类/${parts[0]}`;
  }
  return parts.slice(0, Math.max(1, parts.length - 1)).join("/") || "未归类";
}

export function assetWorkLabel(folder: string): string {
  if (folder.startsWith("works/")) return folder.slice(6).replace("/", " · ") || "未归类";
  const types: Record<string, string> = { image: "图片", video: "视频", audio: "音频", text: "文本" };
  if (folder.startsWith("未归类/")) {
    const t = folder.slice("未归类/".length);
    return `未归类 · ${types[t] ?? t}`;
  }
  return folder;
}

export interface AssetFolderNode {
  id: string;
  label: string;
  folder: string;
  count: number;
  children: AssetFolderNode[];
}

/** 把扁平作品夹收成树：作品 / 连载名 / 第N集，未归类挂在最后。 */
export function buildAssetFolderTree(folders: Array<{ folder: string; count: number }>): AssetFolderNode[] {
  const works: AssetFolderNode = { id: "works", label: "作品", folder: "works", count: 0, children: [] };
  const loose: AssetFolderNode = { id: "未归类", label: "未归类", folder: "未归类", count: 0, children: [] };
  const workMap = new Map<string, AssetFolderNode>();
  const types: Record<string, string> = { image: "图片", video: "视频", audio: "音频", text: "文本" };

  for (const f of folders) {
    if (f.folder.startsWith("works/")) {
      const rest = f.folder.slice(6).split("/").filter(Boolean);
      const series = rest[0] ?? "未归类";
      let parent = workMap.get(series);
      if (!parent) {
        parent = { id: `works/${series}`, label: series, folder: `works/${series}`, count: 0, children: [] };
        workMap.set(series, parent);
        works.children.push(parent);
      }
      if (rest[1]) {
        parent.children.push({
          id: f.folder,
          label: rest[1]!,
          folder: f.folder,
          count: f.count,
          children: [],
        });
      }
      parent.count += f.count;
      works.count += f.count;
    } else if (f.folder.startsWith("未归类/")) {
      const t = f.folder.slice("未归类/".length);
      loose.children.push({
        id: f.folder,
        label: types[t] ?? t,
        folder: f.folder,
        count: f.count,
        children: [],
      });
      loose.count += f.count;
    }
  }

  works.children.sort((a, b) => a.label.localeCompare(b.label, "zh"));
  for (const w of works.children) w.children.sort((a, b) => a.label.localeCompare(b.label, "zh"));
  const out: AssetFolderNode[] = [];
  if (works.children.length) out.push(works);
  if (loose.children.length) out.push(loose);
  return out;
}

/** 从规范文件名中解析（重命名时用）：image_标题_a3f2.png 或旧的 1004_标题_a3f2.png */
export function parseAssetFileName(name: string): { prefix: string; title: string; hash: string; ext: string } | null {
  const m = /^(.+?)_(.+)_([0-9a-f]{4})\.([a-z0-9]+)$/i.exec(name);
  if (!m) return null;
  return { prefix: m[1]!, title: m[2]!, hash: m[3]!, ext: m[4]! };
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
  seriesId: string | null;
  episodeIndex: number | null;
  createdAt: number;
  updatedAt: number;
}

export type SeriesKind = "drama" | "free" | "whiteboard";

export interface Series {
  id: string;
  name: string;
  kind: SeriesKind;
  stylePackId: string | null;
  substyle: string | null;
  paletteJson: string | null;
  bibleJson: string | null;
  episodeCount: number;
  lastProjectId: string | null;
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
  "timeline.tts": "字幕配音",
  "timeline.finish": "装时间线并配音",
  "gen.chat": "文本对话",
  "radar.fetch": "雷达取热点",
  "radar.digest": "雷达早报",
  "analyze.run": "竞品分析",
  "remake.run": "爆款复刻",
  "pipeline.run": "做成片子",
  "pipeline.episode": "出这一集",
  "compose.keys": "出人物和场景图",
  "style.import": "导入风格",
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
