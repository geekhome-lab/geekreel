/**
 * 从画面和台词猜这一镜该落什么音效，再去资产库对上。
 */

import type { DramaBible, DramaShot } from "@vw/core";

const RULES: Array<{ cue: string; re: RegExp }> = [
  { cue: "雨", re: /下雨|暴雨|雷雨|雨声/ },
  { cue: "风", re: /狂风|呼啸|风声/ },
  { cue: "开门", re: /开门|推门|敲门|摔门/ },
  { cue: "刀", re: /拔刀|刀光|出剑|刀锋/ },
  { cue: "马蹄", re: /马蹄|骑马|奔马|战马/ },
  { cue: "人群", re: /街市|人群|喧哗|叫卖/ },
  { cue: "酒碗", re: /喝酒|碰杯|酒碗|饮酒/ },
  { cue: "脚步", re: /脚步|走上|跑来|踏步/ },
  { cue: "水", re: /河水|溪水|水声|落水/ },
  { cue: "火", re: /火光|燃烧|爆炸|着火/ },
  { cue: "鸟", re: /鸟叫|鸦|雀/ },
];

export function suggestSfxCue(visual: string, line = ""): string | null {
  const hay = `${visual}\n${line}`;
  return RULES.find((r) => r.re.test(hay))?.cue ?? null;
}

export function applySfxCues(bible: DramaBible): DramaBible {
  return {
    ...bible,
    episodes: bible.episodes.map((ep) => ({
      ...ep,
      shots: ep.shots.map((shot) => fillSfxCue(shot)),
    })),
  };
}

export function fillSfxCue(shot: DramaShot): DramaShot {
  if (shot.sfxCue) return shot;
  return { ...shot, sfxCue: suggestSfxCue(shot.visual || shot.imagePrompt, shot.line) };
}
