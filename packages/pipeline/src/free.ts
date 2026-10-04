/**
 * 自由创作 / 无链接复刻：先出一份短分镜，用户确认后再搭画布。
 */

import type { FreePlan, FreeShot } from "@vw/core";

export const FREE_PLAN_SYSTEM =
  "你是短视频分镜师。把用户一句话拆成可拍摄的 3 到 5 个镜头。不要编造用户没提到的产品或人名。只输出 JSON。";

export const FREE_REVISE_SYSTEM =
  "你是短视频分镜师。按用户意见改这份分镜，镜头数量可以增减，但仍保持 3 到 5 镜。只输出 JSON。";

export const REMAKE_PLAN_SYSTEM =
  "你是短视频复刻编剧。按用户说的结构和主题，列 3 到 5 个槽位镜头。保持钩子-展开-收束。只输出 JSON。";

export function freePlanPrompt(story: string, lockedLine?: string): string {
  return `把下面的想法拆成分镜 JSON：
{"title":"短标题","summary":"一两句在拍什么","shots":[{"id":"S01","visual":"画面","line":"台词或旁白","imagePrompt":"可直接文生图的画面，不要堆镜头术语"}]}

规则：
- 正好 3 到 5 镜，每镜一件事。
- imagePrompt 写清楚人物外形和场景，方便出图。
${lockedLine ? `- 这是连载下一集，必须沿用：${lockedLine}\n` : ""}
想法：
${story.trim()}`;
}

export function remakePlanPrompt(story: string): string {
  return `用户想复刻一种结构，但没贴原片链接。按他的说明列分镜 JSON：
{"title":"短标题","summary":"沿用什么结构、换成什么主题","shots":[{"id":"S01","visual":"画面","line":"台词或旁白","imagePrompt":"可直接文生图的画面"}]}

3 到 5 镜，钩子放第一镜。
说明：
${story.trim()}`;
}

export function reviseFreePlanPrompt(plan: FreePlan, instruction: string): string {
  return `按用户意见改这份分镜。保留还能用的镜头，只改被点名的部分。
当前：${JSON.stringify({ title: plan.title, summary: plan.summary, shots: plan.shots })}
意见：${instruction.trim() || "换一个更清楚的钩子"}

只输出完整 JSON：{"title","summary","shots":[{"id","visual","line","imagePrompt"}]}`;
}

export function parseFreePlan(text: string, fallbackStory: string): FreePlan {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const raw = fenced?.[1] ?? trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return normalizePlan(JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>, fallbackStory);
    } catch {
      /* 走兜底 */
    }
  }
  return fallbackPlan(fallbackStory);
}

function normalizePlan(r: Record<string, unknown>, fallbackStory: string): FreePlan {
  const shots = Array.isArray(r.shots) ? r.shots.map(normalizeShot).filter((s) => s.visual || s.imagePrompt) : [];
  return {
    title: String(r.title ?? "").trim() || guessTitle(fallbackStory),
    summary: String(r.summary ?? "").trim() || fallbackStory.replace(/\s+/g, " ").slice(0, 40),
    shots: clampShots(shots.length ? shots : fallbackPlan(fallbackStory).shots),
  };
}

function normalizeShot(raw: unknown, i: number): FreeShot {
  const x = (raw ?? {}) as Record<string, unknown>;
  const visual = String(x.visual ?? "").trim();
  const imagePrompt = String(x.imagePrompt ?? visual).trim();
  return {
    id: String(x.id ?? `S${String(i + 1).padStart(2, "0")}`),
    visual,
    line: String(x.line ?? "").trim(),
    imagePrompt,
  };
}

function clampShots(shots: FreeShot[]): FreeShot[] {
  const sliced = shots.slice(0, 5);
  while (sliced.length < 3) {
    const i = sliced.length;
    sliced.push({
      id: `S${String(i + 1).padStart(2, "0")}`,
      visual: i === 0 ? "开场定调" : i === 1 ? "展开" : "收束",
      line: "",
      imagePrompt: i === 0 ? "开场定调" : i === 1 ? "展开" : "收束",
    });
  }
  return sliced.map((s, i) => ({ ...s, id: s.id || `S${String(i + 1).padStart(2, "0")}` }));
}

export function fallbackPlan(story: string): FreePlan {
  const seed = story.replace(/\s+/g, " ").trim();
  const title = guessTitle(seed);
  return {
    title,
    summary: seed.slice(0, 40) || "一句话短片",
    shots: [
      { id: "S01", visual: `开场：${seed.slice(0, 24) || title}`, line: "", imagePrompt: `开场定调，${seed}` },
      { id: "S02", visual: "展开这件事", line: "", imagePrompt: `中景展开，${seed}` },
      { id: "S03", visual: "收束定格", line: "", imagePrompt: `结尾定格，${seed}` },
    ],
  };
}

function guessTitle(story: string): string {
  return story.replace(/\s+/g, " ").trim().slice(0, 12) || "未命名短片";
}
