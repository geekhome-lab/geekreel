import type { CharacterDossier } from "@vw/core";

/** 把档案写进提示词，生成时必须长得像定妆，不能只当给人看的说明书。 */
export function lockCastIntoPrompt(opts: {
  prompt: string;
  cast: CharacterDossier[];
  lastFrame?: string | null;
  dialogue?: string | null;
}): string {
  const text = opts.prompt.trim();
  const mentioned = opts.cast.filter((c) => c.name && text.includes(c.name));
  const used = (mentioned.length ? mentioned : opts.cast).slice(0, 4);
  const lock = used
    .map((c) => {
      const look = [c.appearance, c.outfit].filter(Boolean).join("；") || c.prompt || c.name;
      return `角色锁定「${c.name}」：${look}。必须和定妆同一张脸、同一发型、同一套衣服，禁止换脸。`;
    })
    .join("\n");
  const talk = opts.dialogue?.trim()
    ? `角色对着镜头说：「${opts.dialogue.trim()}」。嘴型必须对上这句，能出声就一起出声。`
    : "";
  const tail = opts.lastFrame?.trim() ? `首帧承接上一镜尾帧：${opts.lastFrame.trim()}` : "";
  return [lock, text, talk, tail].filter(Boolean).join("\n");
}

/** 台词里点到谁，就带谁的定妆；没点名就带前几个有图的。 */
export function pickCastImageIds(cast: CharacterDossier[], text: string): string[] {
  const hay = text.trim();
  const named = cast.filter((c) => c.imageAssetId && c.name && hay.includes(c.name));
  const pool = named.length ? named : cast.filter((c) => c.imageAssetId);
  return [...new Set(pool.map((c) => c.imageAssetId!).filter(Boolean))].slice(0, 3);
}

export function shotDurationSec(shot: { startSec?: number; endSec?: number }): number {
  const raw = (shot.endSec ?? 5) - (shot.startSec ?? 0);
  return Math.min(8, Math.max(3, raw || 5));
}
