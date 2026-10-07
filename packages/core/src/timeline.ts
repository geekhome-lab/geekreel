/**
 * 时间线领域模型 + SRT 工具（纯函数，前后端共享）。
 * 视频/音频/字幕轨；片段可变速，淡入淡出可选。
 */

export type TimelineTransition = "none" | "fade";

export interface TimelineClip {
  id: string;
  /** 视频/音频片段引用的资产 id；字幕片段无 */
  assetId?: string;
  /** 字幕文本（仅字幕轨） */
  text?: string;
  /** 在时间线上的起始位置 ms */
  startMs: number;
  /** 素材入点/出点 ms；字幕片段用 inMs=startMs 语义不用，直接用 startMs/outMs 区间 */
  inMs: number;
  outMs: number;
  /** 音量 0-1，默认 1 */
  volume: number;
  /** 播放倍速，默认 1 */
  speed?: number;
  /** 片段淡入淡出，默认硬切 */
  transition?: TimelineTransition;
  /** 淡入淡出时长 ms，默认 400 */
  transitionMs?: number;
}

export interface TimelineTrack {
  id: string;
  type: "video" | "audio" | "subtitle";
  name: string;
  clips: TimelineClip[];
}

export interface TimelineDoc {
  version: 1;
  width: number;
  height: number;
  tracks: TimelineTrack[];
}

export function emptyTimelineDoc(opts?: { portrait?: boolean }): TimelineDoc {
  return {
    version: 1,
    width: opts?.portrait ? 1080 : 1280,
    height: opts?.portrait ? 1920 : 720,
    tracks: [
      { id: "v1", type: "video", name: "视频", clips: [] },
      { id: "a1", type: "audio", name: "音频 1", clips: [] },
      { id: "s1", type: "subtitle", name: "字幕", clips: [] },
    ],
  };
}

export function clipSpeed(c: TimelineClip): number {
  const s = c.speed && c.speed > 0 ? c.speed : 1;
  return Math.max(0.25, Math.min(4, s));
}

export function clipDuration(c: TimelineClip): number {
  return Math.max(1, Math.round((c.outMs - c.inMs) / clipSpeed(c)));
}

/** 时间线总时长：所有轨道的最远端 */
export function timelineDuration(doc: TimelineDoc): number {
  let max = 0;
  for (const t of doc.tracks) {
    for (const c of t.clips) {
      max = Math.max(max, c.startMs + clipDuration(c));
    }
  }
  return max;
}

export function videoTrack(doc: TimelineDoc): TimelineTrack {
  const t = doc.tracks.find((t) => t.type === "video");
  if (!t) throw new Error("时间线缺少视频轨");
  return t;
}

export function subtitleTrack(doc: TimelineDoc): TimelineTrack | undefined {
  return doc.tracks.find((t) => t.type === "subtitle");
}

export function audioTracks(doc: TimelineDoc): TimelineTrack[] {
  return doc.tracks.filter((t) => t.type === "audio");
}

const BGM_TRACK_ID = "a_bgm";

/** 整条片子铺一层配乐，音量压低，不盖过人声。 */
export function layBgm(doc: TimelineDoc, assetId: string, opts?: { volume?: number; durationMs?: number }): TimelineDoc {
  const durationMs = Math.max(opts?.durationMs ?? timelineDuration(doc), 1000);
  const volume = Math.min(1, Math.max(0.04, opts?.volume ?? 0.22));
  const tracks = doc.tracks.filter((t) => t.id !== BGM_TRACK_ID);
  const videoIdx = tracks.findIndex((t) => t.type === "video");
  const insertAt = videoIdx >= 0 ? videoIdx + 1 : tracks.length;
  tracks.splice(insertAt, 0, {
    id: BGM_TRACK_ID,
    type: "audio",
    name: "配乐",
    clips: [
      {
        id: "c_bgm",
        assetId,
        startMs: 0,
        inMs: 0,
        outMs: durationMs,
        volume,
      },
    ],
  });
  return { ...doc, tracks };
}

// ---------------------------------------------------------------------------
// SRT
// ---------------------------------------------------------------------------

export interface SrtCue {
  startMs: number;
  endMs: number;
  text: string;
}

export function msToSrtTime(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3600000);
  const m = Math.floor((t % 3600000) / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const milli = t % 1000;
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(milli, 3)}`;
}

export function srtTimeToMs(s: string): number {
  const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(s.trim());
  if (!m) return 0;
  return Number(m[1]) * 3600000 + Number(m[2]) * 60000 + Number(m[3]) * 1000 + Number(m[4]);
}

export function parseSrt(text: string): SrtCue[] {
  const cues: SrtCue[] = [];
  const blocks = text.replace(/\r/g, "").split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    if (lines.length < 2) continue;
    const timeLine = lines[0]?.includes("-->") ? lines[0] : lines[1];
    if (!timeLine || !timeLine.includes("-->")) continue;
    const [start, end] = timeLine.split("-->");
    const textLines = lines[0]?.includes("-->") ? lines.slice(1) : lines.slice(2);
    cues.push({
      startMs: srtTimeToMs(start ?? ""),
      endMs: srtTimeToMs(end ?? ""),
      text: textLines.join("\n"),
    });
  }
  return cues;
}

export function formatSrt(cues: SrtCue[]): string {
  return cues
    .map((c, i) => `${i + 1}\n${msToSrtTime(c.startMs)} --> ${msToSrtTime(c.endMs)}\n${c.text}`)
    .join("\n\n")
    .concat("\n");
}

export function msToAssTime(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3600000);
  const m = Math.floor((t % 3600000) / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const cs = Math.floor((t % 1000) / 10);
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${h}:${p(m)}:${p(s)}.${p(cs)}`;
}

function escapeAssText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/[{}]/g, "").replace(/\n/g, "\\N");
}

/** 按画面分辨率写 ASS，避免 libass 默认 288 画布把字放得巨大。 */
export function formatAss(cues: SrtCue[], opts?: { width?: number; height?: number }): string {
  const width = opts?.width && opts.width > 0 ? opts.width : 1080;
  const height = opts?.height && opts.height > 0 ? opts.height : 1920;
  const portrait = height > width;
  const font = portrait ? 34 : 26;
  const marginV = Math.round(height * (portrait ? 0.068 : 0.055));
  const marginX = Math.round(width * (portrait ? 0.08 : 0.05));
  const outline = portrait ? 1.35 : 1.15;
  const events = cues
    .filter((c) => c.text.trim())
    .map((c) => `Dialogue: 0,${msToAssTime(c.startMs)},${msToAssTime(c.endMs)},Caption,,0,0,0,,${escapeAssText(c.text.trim())}`)
    .join("\n");
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,PingFang SC,${font},&H00F4F1EA,&H000000FF,&H6620140A,&H00000000,0,0,0,0,100,100,0.6,0,1,${outline},0,2,${marginX},${marginX},${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events}
`;
}

/** 字幕轨 → SRT  cues（按开始时间排序） */
export function subtitleCues(doc: TimelineDoc): SrtCue[] {
  const track = subtitleTrack(doc);
  if (!track) return [];
  return track.clips
    .filter((c) => c.text?.trim())
    .map((c) => ({ startMs: c.startMs, endMs: c.startMs + clipDuration(c), text: c.text!.trim() }))
    .sort((a, b) => a.startMs - b.startMs);
}
