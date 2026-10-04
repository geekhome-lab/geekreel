import { clipDuration, emptyTimelineDoc, extractDialogue, spokenLine, type ScriptScene, type TimelineDoc } from "@vw/core";

export { extractDialogue, spokenLine };

export interface SubCue {
  text: string;
  startMs: number;
  durationMs: number;
}

export interface FinishClip {
  videoAssetId: string;
  durationMs: number;
  line: string;
  cues?: SubCue[];
}

export interface DubbedClip {
  assetId: string;
  durationMs: number;
}

const MAX_LINE = 12;

/** 竖屏一行大约十四字，最多两行。 */
export function wrapSubtitle(text: string, maxChars = MAX_LINE): string {
  const clean = text.replace(/\s+/g, "").trim();
  if (!clean) return "";
  if (clean.length <= maxChars) return clean;
  const lines: string[] = [];
  let rest = clean;
  while (rest && lines.length < 2) {
    if (rest.length <= maxChars) {
      lines.push(rest);
      break;
    }
    let cut = maxChars;
    const window = rest.slice(0, maxChars + 1);
    const punct = Math.max(window.lastIndexOf("，"), window.lastIndexOf("、"), window.lastIndexOf(","), window.lastIndexOf(" "));
    if (punct >= Math.floor(maxChars * 0.45)) cut = punct + (window[punct] === " " ? 0 : 1);
    lines.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  return lines.filter(Boolean).join("\n");
}

function chopLong(text: string, max = 22): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    let cut = MAX_LINE;
    const window = rest.slice(0, max);
    const punct = Math.max(window.lastIndexOf("，"), window.lastIndexOf("、"), window.lastIndexOf(","));
    if (punct >= 8) cut = punct + 1;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out.filter(Boolean);
}

/** 整段旁白拆成一条条能看的字幕，按时长摊开。 */
export function splitSpokenCues(text: string, durationMs: number): SubCue[] {
  const raw = text.replace(/\r/g, "").trim();
  if (!raw) return [];
  const parts = raw
    .split(/[\n]+|(?<=[。！？…!?])/)
    .map((s) => s.replace(/^[。．.]+|[。．.]+$/g, "").trim())
    .filter(Boolean)
    .flatMap((s) => chopLong(s));
  if (parts.length === 0) return [];
  const window = Math.max(800, durationMs);
  const weights = parts.map((p) => Math.max(4, p.length));
  const total = weights.reduce((a, b) => a + b, 0);
  let t = 0;
  return parts.map((part, i) => {
    const dur = i === parts.length - 1 ? Math.max(600, window - t) : Math.max(600, Math.round((weights[i]! / total) * window));
    const startMs = t;
    t += dur;
    return { text: wrapSubtitle(part), startMs, durationMs: dur };
  });
}

export function cuesFromScenes(
  scenes: Array<Pick<ScriptScene, "lines" | "heading" | "startSec" | "endSec">>,
  durationMs: number,
): SubCue[] {
  const items = scenes
    .map((s) => {
      const text = spokenLine(s).trim();
      const timed = Math.max(0, (s.endSec ?? 0) - (s.startSec ?? 0));
      return { text, weight: timed > 0 ? timed : Math.max(4, text.length) };
    })
    .filter((x) => x.text);
  if (!items.length) return [];
  const window = Math.max(800, durationMs);
  const total = items.reduce((a, b) => a + b.weight, 0);
  let t = 0;
  const out: SubCue[] = [];
  items.forEach((item, i) => {
    const slice = i === items.length - 1 ? Math.max(600, window - t) : Math.max(600, Math.round((item.weight / total) * window));
    for (const cue of splitSpokenCues(item.text, slice)) {
      out.push({ ...cue, startMs: t + cue.startMs });
    }
    t += slice;
  });
  return out;
}

/** 片子比场次少时，把整份剧本字幕按时长铺到现有视频上。 */
export function fitCuesToClips(
  clips: FinishClip[],
  scenes: Array<Pick<ScriptScene, "lines" | "heading" | "startSec" | "endSec">>,
): FinishClip[] {
  if (!clips.length || scenes.length <= clips.length) return clips;
  const total = clips.reduce((a, c) => a + Math.max(400, c.durationMs), 0);
  const all = cuesFromScenes(scenes, total);
  let offset = 0;
  return clips.map((clip) => {
    const start = offset;
    const end = offset + Math.max(400, clip.durationMs);
    offset = end;
    const cues = all
      .filter((c) => c.startMs >= start && c.startMs < end)
      .map((c) => ({
        text: c.text,
        startMs: c.startMs - start,
        durationMs: Math.min(c.durationMs, Math.max(400, end - c.startMs)),
      }));
    return {
      ...clip,
      line: cues.map((c) => c.text.replace(/\n/g, "")).join("\n") || clip.line,
      cues,
    };
  });
}

/** 视频 + 可选字幕 + 可选配音，排成一条时间线 */
export function buildFinishTimeline(
  clips: FinishClip[],
  opts?: {
    portrait?: boolean;
    withSubtitles?: boolean;
    dubbed?: DubbedClip[];
  },
): TimelineDoc {
  const doc = emptyTimelineDoc({ portrait: opts?.portrait });
  const vTrack = doc.tracks.find((t) => t.type === "video")!;
  const aTrack = doc.tracks.find((t) => t.type === "audio")!;
  const sTrack = doc.tracks.find((t) => t.type === "subtitle")!;
  const withSubs = opts?.withSubtitles !== false;
  const dubbed = opts?.dubbed ?? [];

  let cursor = 0;
  clips.forEach((clip, i) => {
    const dur = Math.max(400, Math.round(clip.durationMs) || 5000);
    const voice = dubbed[i]?.assetId ? dubbed[i] : undefined;
    vTrack.clips.push({
      id: `c_v_${i}`,
      assetId: clip.videoAssetId,
      startMs: cursor,
      inMs: 0,
      outMs: dur,
      volume: voice ? 0 : 1,
    });
    if (voice) {
      aTrack.clips.push({
        id: `c_a_${i}`,
        assetId: voice.assetId,
        startMs: cursor,
        inMs: 0,
        outMs: Math.max(400, voice.durationMs || dur),
        volume: 1,
      });
    }
    if (withSubs) {
      const window = Math.max(400, voice?.durationMs || dur);
      const cues = (clip.cues?.length ? clip.cues : splitSpokenCues(clip.line, window)).filter((c) => c.text.trim());
      cues.forEach((cue, j) => {
        sTrack.clips.push({
          id: `c_s_${i}_${j}`,
          text: cue.text.trim(),
          startMs: cursor + Math.max(0, cue.startMs),
          inMs: 0,
          outMs: Math.max(400, cue.durationMs),
          volume: 1,
        });
      });
    }
    const audioEnd = voice ? cursor + clipDuration(aTrack.clips.at(-1)!) : cursor + dur;
    cursor = Math.max(cursor + dur, audioEnd);
  });
  return doc;
}
