/**
 * @vw/pipeline —— 小说转短剧圣经解析 + 默认 5 集骨架。
 * 风格注入由 @vw/style 负责，这里只出结构和兜底。
 */

import type { DramaAssetItem, DramaBible, DramaEpisode, DramaShot, PaletteDoc } from "@vw/core";

export * from "./lock";

export const NOVEL_DRAMA_SYSTEM =
  "你是国风短剧编剧。把故事拆成正好 5 集、每集 3 个镜头的可拍摄圣经。只输出 JSON，不要解释。";

export const NOVEL_CONTINUE_SYSTEM =
  "你是国风短剧编剧。这是一部已有连载的下一集。必须沿用已锁定的人物、场景和色盘，只写这一集。只输出 JSON，不要解释。";

export function novelDramaPrompt(story: string, packHint: string): string {
  return `把下面的故事做成短剧圣经。必须正好 5 集，每集 3 镜（0-5s / 5-10s / 10-15s）。
用说书人旁白体制：开场定调、过场压缩、结尾点题用第三人称短句。
${packHint}

输出 JSON：
{"title":"剧名","palette":{"note":"色调一句话","colors":[{"name":"色名","hex":"#RRGGBB","role":"主/辅/点缀/底"}]},"assets":[{"id":"C01","kind":"character|scene|prop","name":"名","prompt":"造型描述"}],"episodes":[{"index":1,"title":"集标题","synopsis":"本集一事","narrator":"说书人旁白","lastFrame":"本集最后一格静止画面","shots":[{"startSec":0,"endSec":5,"visual":"画面","line":"对白或旁白","imagePrompt":"可直接文生图的画面（先不要写风格词）"}]}]}

故事：
${story.trim()}`;
}

export function novelContinuePrompt(
  story: string,
  packHint: string,
  locked: { title: string; episodeIndex: number; lastFrame: string; assetsLine: string; paletteLine: string },
): string {
  return `这是连载《${locked.title}》的第 ${locked.episodeIndex} 集。必须沿用已有人物和场景，不要改造型、不要换色盘。
${packHint}
已锁定色盘：${locked.paletteLine || "沿用上集"}
已锁定资产：${locked.assetsLine || "沿用上集"}
上集尾帧：${locked.lastFrame || "无"}

只输出 1 集、3 镜的 JSON：
{"title":"${locked.title}","palette":{"note":"沿用","colors":[]},"assets":[],"episodes":[{"index":${locked.episodeIndex},"title":"本集标题","synopsis":"本集一事","narrator":"说书人旁白","lastFrame":"本集最后一格","shots":[{"startSec":0,"endSec":5,"visual":"画面","line":"对白或旁白","imagePrompt":"可直接文生图（先不要写风格词）"}]}]}

本集故事：
${story.trim()}`;
}

export function parseDramaBible(text: string, fallbackStory: string, opts?: { episodeCount?: number }): DramaBible {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const raw = fenced?.[1] ?? trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return normalizeBible(JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>, fallbackStory, opts?.episodeCount ?? 5);
    } catch {
      /* 走兜底 */
    }
  }
  return fallbackBible(fallbackStory, opts?.episodeCount ?? 5);
}

function normalizeBible(r: Record<string, unknown>, fallbackStory: string, episodeCount: number): DramaBible {
  const palette = normalizePalette(r.palette);
  const assets = Array.isArray(r.assets) ? r.assets.map(normalizeAsset).filter((a) => a.name) : [];
  let episodes = Array.isArray(r.episodes) ? r.episodes.map(normalizeEpisode) : [];
  episodes = fillToN(episodes, fallbackStory, String(r.title ?? "").trim() || guessTitle(fallbackStory), episodeCount);
  const cast = Array.isArray(r.cast)
    ? (r.cast as unknown[]).map((x, i) => {
        const a = (x ?? {}) as Record<string, unknown>;
        return {
          id: String(a.id ?? `C${i + 1}`),
          name: String(a.name ?? "").trim(),
          identity: String(a.identity ?? ""),
          personality: String(a.personality ?? ""),
          appearance: String(a.appearance ?? ""),
          outfit: String(a.outfit ?? ""),
          prompt: String(a.prompt ?? ""),
          imageAssetId: typeof a.imageAssetId === "string" ? a.imageAssetId : null,
        };
      }).filter((c) => c.name)
    : undefined;
  const events = Array.isArray(r.events)
    ? (r.events as unknown[]).map((x, i) => {
        const e = (x ?? {}) as Record<string, unknown>;
        return {
          id: String(e.id ?? `E${i + 1}`),
          chapter: String(e.chapter ?? ""),
          index: Number(e.index) || i + 1,
          title: String(e.title ?? ""),
          summary: String(e.summary ?? ""),
          characters: Array.isArray(e.characters) ? e.characters.map((c) => String(c)) : [],
        };
      }).filter((e) => e.title || e.summary)
    : undefined;
  return {
    title: String(r.title ?? "").trim() || guessTitle(fallbackStory),
    packId: null,
    substyle: null,
    palette,
    assets,
    episodes,
    cast,
    events,
  };
}

function normalizePalette(raw: unknown): PaletteDoc {
  const r = (raw ?? {}) as Record<string, unknown>;
  const colors = Array.isArray(r.colors)
    ? r.colors.map((c) => {
        const x = (c ?? {}) as Record<string, unknown>;
        return { name: String(x.name ?? "色").trim(), hex: String(x.hex ?? "").trim(), role: String(x.role ?? "").trim() };
      }).filter((c) => c.name)
    : [];
  return {
    note: String(r.note ?? "").trim(),
    colors: colors.length ? colors : defaultPalette().colors,
  };
}

function normalizeAsset(raw: unknown): DramaAssetItem {
  const x = (raw ?? {}) as Record<string, unknown>;
  const kind = x.kind === "scene" || x.kind === "prop" ? x.kind : "character";
  return {
    id: String(x.id ?? "").trim() || "X",
    kind,
    name: String(x.name ?? "").trim(),
    prompt: String(x.prompt ?? "").trim(),
  };
}

function normalizeEpisode(raw: unknown, i: number): DramaEpisode {
  const x = (raw ?? {}) as Record<string, unknown>;
  const shotsRaw = Array.isArray(x.shots) ? x.shots : [];
  const shots = shotsRaw.map((s, si) => normalizeShot(s, si));
  return {
    index: num(x.index, i + 1),
    title: String(x.title ?? `第 ${i + 1} 集`).trim(),
    synopsis: String(x.synopsis ?? "").trim(),
    narrator: String(x.narrator ?? "").trim(),
    lastFrame: String(x.lastFrame ?? shots.at(-1)?.visual ?? "").trim(),
    shots: shots.length ? shots : defaultShots(String(x.synopsis ?? x.title ?? "空镜")),
  };
}

function normalizeShot(raw: unknown, i: number): DramaShot {
  const x = (raw ?? {}) as Record<string, unknown>;
  const start = num(x.startSec, i * 5);
  return {
    startSec: start,
    endSec: num(x.endSec, start + 5),
    visual: String(x.visual ?? "").trim(),
    line: String(x.line ?? "").trim(),
    imagePrompt: String(x.imagePrompt ?? x.visual ?? "").trim(),
  };
}

function fillToN(episodes: DramaEpisode[], story: string, title: string, n: number): DramaEpisode[] {
  const need = Math.max(1, Math.min(5, n));
  const out = episodes.slice(0, need);
  while (out.length < need) {
    const i = out.length;
    out.push({
      index: i + 1,
      title: `${title} · 第 ${i + 1} 集`,
      synopsis: i === 0 ? story.slice(0, 80) : "承上启下",
      narrator: "",
      lastFrame: "",
      shots: defaultShots(story.slice(0, 40)),
    });
  }
  return out.map((e, i) => ({ ...e, index: i + 1 }));
}

function defaultShots(seed: string): DramaShot[] {
  return [
    { startSec: 0, endSec: 5, visual: `开场：${seed}`, line: "未见转写", imagePrompt: `开场定调，${seed}` },
    { startSec: 5, endSec: 10, visual: "展开冲突", line: "未见转写", imagePrompt: `中景展开，${seed}` },
    { startSec: 10, endSec: 15, visual: "收束", line: "未见转写", imagePrompt: `结尾定格，${seed}` },
  ];
}

export function fallbackBible(story: string, episodeCount = 5): DramaBible {
  const title = guessTitle(story);
  return {
    title,
    packId: null,
    substyle: null,
    palette: defaultPalette(),
    assets: [{ id: "C01", kind: "character", name: "主角", prompt: story.slice(0, 40) || "主角" }],
    episodes: fillToN([], story, title, episodeCount),
  };
}

export function defaultPalette(): PaletteDoc {
  return {
    note: "矿物四色，平涂用",
    colors: [
      { name: "朱砂", hex: "#C23A2B", role: "主" },
      { name: "石青", hex: "#2F6F8F", role: "辅" },
      { name: "藤黄", hex: "#E2B23A", role: "点缀" },
      { name: "墨褐", hex: "#2A2118", role: "线" },
      { name: "宣纸", hex: "#F3E6C8", role: "底" },
    ],
  };
}

export * from "./whiteboard";
export * from "./fetchNovel";
export * from "./cast";
export * from "./free";

export function guessTitle(story: string): string {
  const line = story.replace(/\s+/g, " ").trim();
  return line.slice(0, 12) || "未命名短剧";
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : fallback;
}

/** 下一集第一镜带上上一集尾帧 */
export function stitchEpisodeFrames(bible: DramaBible): DramaBible {
  const episodes = bible.episodes.map((ep, i) => {
    if (i === 0) return ep;
    const prev = bible.episodes[i - 1]!;
    const first = ep.shots[0];
    if (!first || !prev.lastFrame) return ep;
    if (first.imagePrompt.includes(prev.lastFrame)) return ep;
    return {
      ...ep,
      shots: [
        { ...first, imagePrompt: `${first.imagePrompt}。承接上集尾帧：${prev.lastFrame}` },
        ...ep.shots.slice(1),
      ],
    };
  });
  return { ...bible, episodes };
}
