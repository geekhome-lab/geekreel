import { expect, test } from "bun:test";
import type { CharacterDossier, DramaBible } from "@vw/core";
import { bindEntitiesToShots, lockProductionIntoPrompt, pickShotRefImages, viewPrompt } from "./entities";

const wu: CharacterDossier = {
  id: "C01",
  name: "武松",
  identity: "行者",
  personality: "暴烈",
  appearance: "豹头环眼",
  outfit: "青布头巾",
  prompt: "武松",
  imageAssetId: "img-wu",
  views: [
    { kind: "face", assetId: "img-face" },
    { kind: "front", assetId: "img-front" },
  ],
};

const inn = { id: "S01", kind: "scene" as const, name: "酒店", prompt: "宋代酒旗", imageAssetId: "img-inn" };

const bible: DramaBible = {
  title: "武松",
  packId: null,
  substyle: null,
  palette: { note: "", colors: [] },
  assets: [inn],
  cast: [wu],
  episodes: [
    {
      index: 1,
      title: "第一集",
      synopsis: "",
      narrator: "",
      lastFrame: "",
      shots: [{ startSec: 0, endSec: 5, visual: "武松在酒店喝酒", line: "这酒好", imagePrompt: "武松举碗" }],
    },
  ],
};

test("点到的人和场景都写进锁定，每镜带上引用", () => {
  const bound = bindEntitiesToShots(bible);
  expect(bound.episodes[0]!.shots[0]!.entityIds).toEqual(["C01", "S01"]);
  const prompt = lockProductionIntoPrompt({
    prompt: "武松在酒店喝酒",
    bible: bound,
    entityIds: bound.episodes[0]!.shots[0]!.entityIds,
    dialogue: "这酒好",
  });
  expect(prompt).toContain("角色锁定「武松」");
  expect(prompt).toContain("场景锁定「酒店」");
});

test("没点名也强制带上主要实体", () => {
  const empty = bindEntitiesToShots({
    ...bible,
    episodes: [
      {
        ...bible.episodes[0]!,
        shots: [{ startSec: 0, endSec: 5, visual: "空镜", line: "", imagePrompt: "夜" }],
      },
    ],
  });
  expect(empty.episodes[0]!.shots[0]!.entityIds?.length).toBeGreaterThan(0);
});

test("参考图带上多视图", () => {
  expect(pickShotRefImages(bible, ["C01"])).toEqual(["img-face", "img-front", "img-wu"]);
});

test("定妆视图提示词按脸/正面/侧面分开", () => {
  expect(viewPrompt({ kind: "character", view: "face", name: "武松", prompt: "豹头" })).toContain("面部特写");
  expect(viewPrompt({ kind: "scene", view: "full", name: "酒店", prompt: "酒旗" })).toContain("没有人物");
});
