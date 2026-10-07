/**
 * 质检：对照定妆看漂脸、换装、换景。不过就打回，只重做这一镜。
 */

import type { ShotQa } from "@vw/core";

export function parseShotQa(text: string, retries = 0): ShotQa {
  const raw = text.trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const j = JSON.parse(raw.slice(start, end + 1)) as { ok?: unknown; score?: unknown; note?: unknown };
      const score = Math.min(1, Math.max(0, Number(j.score) || 0));
      const ok = j.ok === true || (j.ok === undefined && score >= 0.7);
      return {
        ok,
        score,
        note: String(j.note ?? "").trim() || (ok ? "过了" : "漂了"),
        retries,
      };
    } catch {
      /* 走兜底 */
    }
  }
  const fail = /漂|换脸|换装|不是同|不一致|失败/.test(raw);
  return {
    ok: !fail && raw.length > 0,
    score: fail ? 0.3 : 0.6,
    note: raw.slice(0, 80) || "质检没给出结论",
    retries,
  };
}

export function heuristicShotQa(hasRefs: boolean): ShotQa {
  if (!hasRefs) return { ok: false, score: 0.25, note: "这一镜没带定妆图", retries: 0 };
  return { ok: true, score: 0.7, note: "带了定妆，等视觉复核", retries: 0 };
}

export function shouldRetryQa(qa: ShotQa, max = 1): boolean {
  return !qa.ok && qa.retries < max;
}

export function qaReviewPrompt(opts: { visual: string; lock: string }): string {
  return `对照参考图检查这一镜。同一张脸？同一套衣服？场景有没有换地方？
画面：${opts.visual}
锁定：${opts.lock}
只输出 JSON：{"ok":true,"score":0.9,"note":"一句话"}
score 从 0 到 1。漂脸、换装、换场景就 ok=false。`;
}
