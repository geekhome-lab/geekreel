/**
 * 时间线领域模型 + SRT 工具（纯函数，前后端共享）。
 * M3 范围：1 条视频轨 + N 条音频轨 + 1 条字幕轨；硬切，无转场。
 */

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

export function emptyTimelineDoc(): TimelineDoc {
  return {
    version: 1,
    width: 1280,
    height: 720,
    tracks: [
      { id: "v1", type: "video", name: "视频", clips: [] },
      { id: "a1", type: "audio", name: "音频 1", clips: [] },
      { id: "s1", type: "subtitle", name: "字幕", clips: [] },
    ],
  };
}

export function clipDuration(c: TimelineClip): number {
  return c.outMs - c.inMs;
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

/** 字幕轨 → SRT  cues（按开始时间排序） */
export function subtitleCues(doc: TimelineDoc): SrtCue[] {
  const track = subtitleTrack(doc);
  if (!track) return [];
  return track.clips
    .filter((c) => c.text?.trim())
    .map((c) => ({ startMs: c.startMs, endMs: c.startMs + clipDuration(c), text: c.text!.trim() }))
    .sort((a, b) => a.startMs - b.startMs);
}
