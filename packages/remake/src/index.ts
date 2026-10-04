/**
 * @vw/remake —— 把分析模板 + 用户变量填成可跑的分镜。
 */

import type { RemakeTemplateDoc } from "@vw/core";

export const REMAKE_SYSTEM = "你是短视频复刻编剧。保持原结构骨架，只替换主题/产品/人物。只输出 JSON。";

export function remakePrompt(
  template: RemakeTemplateDoc,
  variables: Record<string, string>,
  opts?: { variantIndex?: number; variantCount?: number },
): string {
  const vars = Object.entries(variables)
    .map(([k, v]) => `${k}：${v}`)
    .join("\n");
  const variant =
    opts?.variantCount && opts.variantCount > 1
      ? `\n这是第 ${opts.variantIndex ?? 1}/${opts.variantCount} 个变体。换一个钩子角度或人物口吻，槽位数量和时长不要变。`
      : "";
  return `按这个可复用结构，写成新片子的分镜。保持槽位数量和大致时长，不要加戏。${variant}
模板名：${template.name}
槽位：${JSON.stringify(template.slots)}
用户变量：
${vars}

输出 JSON：
{"shots":[{"slotId":"与模板 id 对应","line":"新台词","imagePrompt":"可直接拿去文生图的画面描述，不要镜头术语堆砌","maxSec":3}]}`;
}

/** 第一版词级对齐：按字数估时长（约 4 字/秒），夹在 1.2s 和槽位上限之间。 */
export function lineDurationMs(line: string, maxSec: number): number {
  const chars = Array.from(line.trim()).length;
  const sec = Math.max(1.2, Math.min(Math.max(1, maxSec), chars / 4 || 1.2));
  return Math.round(sec * 1000);
}

export function assembleSubtitleClips(
  shots: Array<{ line: string; imagePrompt: string; maxSec: number }>,
  opts?: {
    originalShots?: Array<{ startMs: number; endMs: number; line: string }>;
    words?: Array<{ word: string; startMs: number; endMs: number }>;
  },
): Array<{ text: string; startMs: number; durationMs: number }> {
  let t = 0;
  return shots.map((s, i) => {
    const orig = opts?.originalShots?.[i];
    let durationMs = lineDurationMs(s.line || s.imagePrompt, s.maxSec);
    if (orig) {
      const oldDur = Math.max(400, orig.endMs - orig.startMs);
      if (opts?.words && opts.words.length > 0) {
        const span = opts.words.filter((w) => w.startMs >= orig.startMs && w.startMs < orig.endMs);
        if (span.length > 0) {
          durationMs = Math.max(400, (span.at(-1)!.endMs - span[0]!.startMs) || oldDur);
        } else {
          durationMs = oldDur;
        }
      } else {
        const ratio = Math.max(0.6, Math.min(1.8, Array.from(s.line || "").length / Math.max(1, Array.from(orig.line || "").length)));
        durationMs = Math.round(oldDur * ratio);
      }
    }
    const clip = { text: s.line || s.imagePrompt.slice(0, 24), startMs: t, durationMs };
    t += durationMs;
    return clip;
  });
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
