/**
 * 小说 → 角色档案 + 事件清单。不点选风格包，造型从正文里长出来。
 */

import type { CharacterDossier, DramaAssetItem, DramaBible, StoryEvent } from "@vw/core";

export const CAST_SYSTEM =
  "你是剧本统筹。先通读全文，识别所有出场人物，给每人写档案；再按章节抽出关键事件。不要编造正文没有的人。只输出 JSON。";

export const CAST_REVISE_SYSTEM =
  "你是角色造型指导。按用户的新描述（和参考图，如果有）重写这一个角色的档案。其他字段也要自洽。只输出这一个角色的 JSON。";

export const EVENT_REVISE_SYSTEM =
  "你是编剧。按用户意见改这一条事件，不要改人物名字。只输出这一条事件的 JSON。";

export const CAST_TO_BIBLE_SYSTEM =
  "你是短剧编剧。人物造型必须严格按已确认的档案，不要改外貌和穿搭。只输出 JSON。";

export function dossierPrompt(c: CharacterDossier): string {
  return [
    c.name,
    c.identity && `身份：${c.identity}`,
    c.appearance && `外貌：${c.appearance}`,
    c.outfit && `穿搭：${c.outfit}`,
    c.personality && `性格：${c.personality}`,
  ]
    .filter(Boolean)
    .join("。");
}

export function novelCastPrompt(story: string): string {
  return `通读下面的小说，输出 JSON：
{"title":"剧名","summary":"一两句故事","palette":{"note":"从正文气氛归纳的色调","colors":[{"name":"色名","hex":"#RRGGBB","role":"主/辅/点缀/底"}]},"cast":[{"id":"C01","name":"人名","identity":"身份","personality":"性格","appearance":"外貌","outfit":"穿搭","prompt":"可直接文生图的全身设定"}],"events":[{"id":"E01","chapter":"第几章或段落名","index":1,"title":"事件名","summary":"发生了什么","characters":["C01"]}]}

规则：
- 每个出场人物一份档案，外貌、性格、身份、穿搭都写清楚，依据正文，不要套现成画风名。
- 按原文自然章节或明显段落拆事件，每章至少 1 条关键事件，最多 30 条。
- characters 填角色 id。

正文：
${story.trim()}`;
}

export function novelCastContinuePrompt(
  story: string,
  locked: { title: string; castLine: string },
): string {
  return `这是连载《${locked.title}》的下一章。人物档案已经锁定，不要改造型。只抽本章事件。
已锁定人物：${locked.castLine || "沿用上集"}

输出 JSON：
{"title":"${locked.title}","summary":"本章一两句","palette":{"note":"沿用","colors":[]},"cast":[],"events":[{"id":"E01","chapter":"本章","index":1,"title":"事件名","summary":"发生了什么","characters":["C01"]}]}

本章正文：
${story.trim()}`;
}

export function reviseCharacterPrompt(current: CharacterDossier, instruction: string, hasImage: boolean): string {
  return `当前档案：
${JSON.stringify(current)}

用户要求：${instruction.trim() || "按参考重做这个角色"}
${hasImage ? "已附参考图，外貌和穿搭以图为准，再结合文字。" : ""}

只输出这一个角色：
{"id":"${current.id}","name":"${current.name}","identity":"","personality":"","appearance":"","outfit":"","prompt":""}`;
}

export function reviseEventPrompt(current: StoryEvent, instruction: string): string {
  return `当前事件：
${JSON.stringify(current)}

用户要求：${instruction.trim()}

只输出这一条：
{"id":"${current.id}","chapter":"${current.chapter}","index":${current.index},"title":"","summary":"","characters":${JSON.stringify(current.characters)}}`;
}

export function bibleFromCastPrompt(
  story: string,
  bible: Pick<DramaBible, "title" | "cast" | "events" | "palette">,
  episodeCount: number,
): string {
  const cast = (bible.cast ?? []).map((c) => `${c.id} ${dossierPrompt(c)}`).join("\n");
  const events = (bible.events ?? []).map((e) => `${e.id} [${e.chapter}] ${e.title}：${e.summary}`).join("\n");
  return `把已确认的人物和事件做成短剧圣经。必须正好 ${episodeCount} 集，每集 3 镜（0-5s / 5-10s / 10-15s）。
人物必须按档案出镜，不要改外貌穿搭。

剧名：${bible.title}
人物：
${cast || "无"}
事件清单：
${events || "按正文顺序"}

输出 JSON：
{"title":"${bible.title}","palette":{"note":"","colors":[]},"assets":[],"episodes":[{"index":1,"title":"集标题","synopsis":"本集一事","narrator":"旁白","lastFrame":"尾帧","shots":[{"startSec":0,"endSec":5,"visual":"画面","line":"对白或旁白","imagePrompt":"可直接文生图，必须写清人物外貌穿搭"}]}]}

原文摘录：
${story.trim().slice(0, 6000)}`;
}

export function parseCastDoc(text: string, fallbackStory: string): { title: string; summary: string; paletteNote: string; colors: DramaBible["palette"]["colors"]; cast: CharacterDossier[]; events: StoryEvent[] } {
  const json = extractJson(text);
  const r = (json ?? {}) as Record<string, unknown>;
  const title = String(r.title ?? "").trim() || guessTitle(fallbackStory);
  const summary = String(r.summary ?? "").trim();
  const palette = (r.palette ?? {}) as Record<string, unknown>;
  const colors = Array.isArray(palette.colors)
    ? palette.colors
        .map((c) => {
          const x = (c ?? {}) as Record<string, unknown>;
          return { name: String(x.name ?? "").trim(), hex: String(x.hex ?? "").trim(), role: String(x.role ?? "").trim() };
        })
        .filter((c) => c.name && c.hex)
    : [];
  const cast = (Array.isArray(r.cast) ? r.cast : []).map((raw, i) => normalizeCast(raw, i)).filter((c) => c.name);
  const events = (Array.isArray(r.events) ? r.events : []).map((raw, i) => normalizeEvent(raw, i)).filter((e) => e.title || e.summary);
  return {
    title,
    summary,
    paletteNote: String(palette.note ?? "").trim(),
    colors,
    cast: cast.length ? cast : fallbackCast(fallbackStory),
    events: events.length ? events.slice(0, 30) : fallbackEvents(fallbackStory),
  };
}

export function parseOneCharacter(text: string, fallback: CharacterDossier): CharacterDossier {
  const json = extractJson(text);
  if (!json) return { ...fallback, prompt: dossierPrompt(fallback) };
  const next = normalizeCast({ ...fallback, ...json }, 0);
  return {
    ...fallback,
    ...next,
    id: fallback.id,
    name: next.name || fallback.name,
    prompt: next.prompt || dossierPrompt(next),
  };
}

export function parseOneEvent(text: string, fallback: StoryEvent): StoryEvent {
  const json = extractJson(text);
  if (!json) return fallback;
  const next = normalizeEvent({ ...fallback, ...json }, fallback.index - 1);
  return { ...fallback, ...next, id: fallback.id, index: fallback.index };
}

export function assetsFromCast(cast: CharacterDossier[]): DramaAssetItem[] {
  return cast.map((c) => ({
    id: c.id,
    kind: "character" as const,
    name: c.name,
    prompt: c.prompt || dossierPrompt(c),
  }));
}

export function castFromAssets(assets: DramaAssetItem[]): CharacterDossier[] {
  return assets
    .filter((a) => a.kind === "character")
    .map((a, i) => ({
      id: a.id || `C${String(i + 1).padStart(2, "0")}`,
      name: a.name,
      identity: "",
      personality: "",
      appearance: a.prompt,
      outfit: "",
      prompt: a.prompt,
      imageAssetId: null,
    }));
}

function normalizeCast(raw: unknown, i: number): CharacterDossier {
  const x = (raw ?? {}) as Record<string, unknown>;
  const name = String(x.name ?? "").trim();
  const identity = String(x.identity ?? x.role ?? "").trim();
  const personality = String(x.personality ?? "").trim();
  const appearance = String(x.appearance ?? "").trim();
  const outfit = String(x.outfit ?? x.clothing ?? "").trim();
  const draft: CharacterDossier = {
    id: String(x.id ?? "").trim() || `C${String(i + 1).padStart(2, "0")}`,
    name,
    identity,
    personality,
    appearance,
    outfit,
    prompt: String(x.prompt ?? "").trim(),
    imageAssetId: typeof x.imageAssetId === "string" ? x.imageAssetId : null,
  };
  if (!draft.prompt) draft.prompt = dossierPrompt(draft);
  return draft;
}

function normalizeEvent(raw: unknown, i: number): StoryEvent {
  const x = (raw ?? {}) as Record<string, unknown>;
  const characters = Array.isArray(x.characters) ? x.characters.map((c) => String(c).trim()).filter(Boolean) : [];
  return {
    id: String(x.id ?? "").trim() || `E${String(i + 1).padStart(2, "0")}`,
    chapter: String(x.chapter ?? "").trim() || `第 ${i + 1} 段`,
    index: Number(x.index) > 0 ? Math.round(Number(x.index)) : i + 1,
    title: String(x.title ?? "").trim(),
    summary: String(x.summary ?? "").trim(),
    characters,
  };
}

function fallbackCast(story: string): CharacterDossier[] {
  return [
    {
      id: "C01",
      name: "主角",
      identity: "待确认",
      personality: "从正文再认",
      appearance: story.slice(0, 40) || "待描述",
      outfit: "待描述",
      prompt: story.slice(0, 40) || "主角",
      imageAssetId: null,
    },
  ];
}

function fallbackEvents(story: string): StoryEvent[] {
  return [
    {
      id: "E01",
      chapter: "开篇",
      index: 1,
      title: "开场",
      summary: story.slice(0, 80) || "关键事件待补",
      characters: ["C01"],
    },
  ];
}

function extractJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const raw = fenced?.[1] ?? trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function guessTitle(story: string): string {
  return story.replace(/\s+/g, " ").trim().slice(0, 12) || "未命名短剧";
}
