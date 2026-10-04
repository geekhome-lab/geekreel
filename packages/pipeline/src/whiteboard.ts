/**
 * 白板动画：SRT / 口播文案 → 分幕。不依赖 Python。
 */

import { parseSrt, type DramaBible, type DramaShot, type SrtCue } from "@vw/core";

export const WHITEBOARD_PALETTE = {
  note: "暖米黄纸底，线稿灰，少量红橙蓝",
  colors: [
    { name: "宣纸", hex: "#F5EBD7", role: "底" },
    { name: "墨灰", hex: "#3A332C", role: "线" },
    { name: "朱红", hex: "#C4542A", role: "点缀" },
    { name: "石青", hex: "#2F6F8F", role: "点缀" },
  ],
};

export function looksLikeSrt(text: string): boolean {
  return /\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}/.test(text);
}

export interface WhiteboardScene {
  startMs: number;
  endMs: number;
  text: string;
  visual: string;
}

/** 按 25–35 秒把字幕条收成幕 */
export function groupCuesIntoScenes(cues: SrtCue[], targetMs = 30_000): WhiteboardScene[] {
  if (cues.length === 0) return [];
  const scenes: WhiteboardScene[] = [];
  let start = cues[0]!.startMs;
  let end = cues[0]!.endMs;
  let texts: string[] = [];
  const flush = () => {
    const text = texts.join(" ").replace(/\s+/g, " ").trim();
    if (!text) return;
    scenes.push({
      startMs: start,
      endMs: Math.max(end, start + 2000),
      text,
      visual: `手绘示意：${text.slice(0, 36)}`,
    });
  };
  for (const cue of cues) {
    const nextEnd = Math.max(cue.endMs, cue.startMs + 500);
    if (texts.length > 0 && nextEnd - start > targetMs) {
      flush();
      start = cue.startMs;
      texts = [];
    }
    if (texts.length === 0) start = cue.startMs;
    end = nextEnd;
    texts.push(cue.text.replace(/\n/g, " ").trim());
  }
  flush();
  return scenes.slice(0, 12);
}

export function scenesFromPlainText(text: string, eachMs = 8000): WhiteboardScene[] {
  const parts = text
    .split(/\n+/)
    .map((l) => l.replace(/^[\d.\-、]+\s*/, "").trim())
    .filter((l) => l.length > 0);
  const lines = parts.length > 0 ? parts : [text.replace(/\s+/g, " ").trim()].filter(Boolean);
  return lines.slice(0, 12).map((line, i) => ({
    startMs: i * eachMs,
    endMs: (i + 1) * eachMs,
    text: line,
    visual: `手绘示意：${line.slice(0, 36)}`,
  }));
}

export function scenesFromInput(raw: string): { cues: SrtCue[]; scenes: WhiteboardScene[] } {
  const text = raw.trim();
  if (looksLikeSrt(text)) {
    const cues = parseSrt(text);
    const scenes = groupCuesIntoScenes(cues);
    return { cues, scenes: scenes.length ? scenes : scenesFromPlainText(text) };
  }
  return { cues: [], scenes: scenesFromPlainText(text) };
}

export function bibleFromWhiteboard(title: string, scenes: WhiteboardScene[]): DramaBible {
  const shots: DramaShot[] = scenes.map((s) => ({
    startSec: Math.round(s.startMs / 1000),
    endSec: Math.round(s.endMs / 1000),
    visual: s.visual,
    line: s.text,
    imagePrompt: s.visual,
  }));
  return {
    title: title.slice(0, 24) || "白板动画",
    packId: "whiteboard",
    substyle: null,
    palette: WHITEBOARD_PALETTE,
    assets: [],
    episodes: [
      {
        index: 1,
        title: title.slice(0, 16) || "白板",
        synopsis: scenes.map((s) => s.text).join(" ").slice(0, 80),
        narrator: "",
        lastFrame: scenes.at(-1)?.visual ?? "",
        shots,
      },
    ],
  };
}
