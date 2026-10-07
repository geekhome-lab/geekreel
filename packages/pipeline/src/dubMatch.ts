import { extractDialogue } from "@vw/core";
import { clipSpokenText, speakCharBudget } from "./dialogue";

export const DUB_FROM_VIDEO_SYSTEM =
  "你在给已经生成的成片配音。画面是唯一事实：只说这一镜画面里正在发生的事。禁止把没拍到的后文、其他场次或整份剧本念出来。只写嘴里能念的中文对白或旁白，不要镜头说明。时长不够就只留一句能说完的。只输出 JSON。";

export function dubStoryHint(
  script: { title?: string; scenes?: Array<{ lines?: Array<{ speaker?: string; text?: string }> }> } | null | undefined,
): string {
  if (!script) return "";
  const names = [
    ...new Set(
      (script.scenes ?? [])
        .flatMap((s) => (s.lines ?? []).map((l) => String(l.speaker ?? "").trim()).filter(Boolean))
        .filter((n) => n !== "旁白"),
    ),
  ].slice(0, 8);
  const title = String(script.title ?? "").trim();
  return [title && `剧名：${title}`, names.length ? `人物：${names.join("、")}` : ""]
    .filter(Boolean)
    .join("。");
}

/** 画面上有人开口才对嘴。旁白、空镜、远景只铺声，不对口型。 */
export function isTalkingShot(opts: { line?: string; visual?: string }): boolean {
  const line = (opts.line ?? "").trim();
  if (!line) return false;
  const visual = opts.visual ?? "";
  const hay = `${line}\n${visual}`;
  if (/(空镜|大远景|航拍)/.test(visual) && !/(说|嘴|开口)/.test(hay)) return false;
  if (/^(旁白|解说|画外音|narrator)[：:]/i.test(line) && !/(对着镜头|开口|说话|特写|近景)/.test(hay)) return false;
  if (/(对着镜头|开口说|嘴型|对白|特写|近景|\bcu\b|\becu\b|\bms\b)/i.test(hay)) return true;
  if (/^[^\n：:]{1,16}[：:]/.test(line) && !/^(旁白|解说|画外音)/.test(line)) return true;
  return !/(远景|大远景|空镜)/.test(visual);
}

/** 这一镜自己的词：节点台词或出片提示里的对白，按画面时长裁。不拿别的场次。 */
export function lineFromClipSource(opts: { durationMs: number; line?: string; visual?: string }): string {
  const own = (opts.line ?? "").trim();
  const fromVisual = extractDialogue(opts.visual ?? "").trim();
  return clipSpokenText(own || fromVisual, opts.durationMs);
}

export function dubFromVideoPrompt(opts: {
  durationMs: number;
  visual?: string;
  storyHint?: string;
  draft?: string;
}): string {
  const sec = (Math.max(400, opts.durationMs) / 1000).toFixed(1);
  const budget = speakCharBudget(opts.durationMs);
  const visual = (opts.visual ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
  const hint = (opts.storyHint ?? "").trim().slice(0, 160);
  const draft = (opts.draft ?? "").trim().slice(0, 80);
  return `给这一镜成片写配音。
时长：${sec} 秒，最多 ${budget} 个字。
出片画面说明（仅供参考，以附上的截图为准）：${visual || "无"}
人物线索（只可借用名字，禁止念没拍到的情节）：${hint || "无"}
草稿（对不上画面就丢掉）：${draft || "无"}

只输出 JSON：{"line":"可直接念的台词","silent":false}
画面里没人开口、也不需要旁白就 silent=true、line=""。`;
}

export function parseDubFromVideo(text: string, durationMs: number): { line: string; silent: boolean } {
  const raw = text.trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const j = JSON.parse(raw.slice(start, end + 1)) as { line?: unknown; silent?: unknown };
      const silent = j.silent === true;
      const line = clipSpokenText(String(j.line ?? "").trim(), durationMs);
      return { line: silent ? "" : line, silent };
    } catch {
      /* 当纯文本 */
    }
  }
  const plain = clipSpokenText(
    raw
      .replace(/^```(?:json)?\s*|\s*```$/g, "")
      .replace(/^["「]|["」]$/g, "")
      .trim(),
    durationMs,
  );
  if (!plain || (/未见|无对白|不出声|silent/i.test(plain) && plain.length < 16)) {
    return { line: "", silent: true };
  }
  return { line: plain, silent: false };
}
