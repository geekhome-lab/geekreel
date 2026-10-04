/**
 * @vw/remake —— 把分析模板 + 用户变量填成可跑的分镜。
 */

import type { RemakeTemplateDoc } from "@vw/core";

export const REMAKE_SYSTEM = "你是短视频复刻编剧。保持原结构骨架，只替换主题/产品/人物。只输出 JSON。";

export function remakePrompt(template: RemakeTemplateDoc, variables: Record<string, string>): string {
  const vars = Object.entries(variables)
    .map(([k, v]) => `${k}：${v}`)
    .join("\n");
  return `按这个可复用结构，写成新片子的分镜。保持槽位数量和大致时长，不要加戏。
模板名：${template.name}
槽位：${JSON.stringify(template.slots)}
用户变量：
${vars}

输出 JSON：
{"shots":[{"slotId":"与模板 id 对应","line":"新台词","imagePrompt":"可直接拿去文生图的画面描述，不要镜头术语堆砌","maxSec":3}]}`;
}

export interface RemakeShot {
  slotId: string;
  line: string;
  imagePrompt: string;
  maxSec: number;
}

export function parseRemakeShots(text: string, template: RemakeTemplateDoc): RemakeShot[] {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const raw = fenced?.[1] ?? trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("复刻稿没有返回 JSON，请换一个文本模型");
  let json: unknown;
  try {
    json = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new Error("复刻稿 JSON 不完整，请重试");
  }
  const list = Array.isArray(json) ? json : (json as { shots?: unknown }).shots;
  if (!Array.isArray(list) || list.length === 0) throw new Error("复刻稿里没有 shots");
  return template.slots.map((slot, i) => {
    const row = (list.find((x) => (x as { slotId?: string }).slotId === slot.id) ?? list[i] ?? {}) as Record<string, unknown>;
    const prompt = String(row.imagePrompt ?? row.prompt ?? slot.shotDesc).trim();
    const line = String(row.line ?? "").trim();
    return {
      slotId: slot.id,
      line,
      imagePrompt: [prompt, line && `字幕：${line}`].filter(Boolean).join("。"),
      maxSec: Math.max(1, Number(row.maxSec) || slot.maxSec),
    };
  });
}
