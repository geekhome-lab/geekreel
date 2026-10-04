import { expect, test } from "bun:test";
import type { CharacterDossier } from "@vw/core";
import { lockCastIntoPrompt, pickCastImageIds, shotDurationSec } from "./lock";

const wu: CharacterDossier = {
  id: "C01",
  name: "武松",
  identity: "行者",
  personality: "暴烈",
  appearance: "豹头环眼",
  outfit: "青布头巾",
  prompt: "武松",
  imageAssetId: "img-wu",
};

test("点到谁就锁谁，并写上定妆约束", () => {
  const out = lockCastIntoPrompt({
    prompt: "武松在酒店门口喝酒",
    cast: [wu],
    lastFrame: "酒碗特写",
    dialogue: "这酒好生有劲",
  });
  expect(out).toContain("角色锁定「武松」");
  expect(out).toContain("豹头环眼");
  expect(out).toContain("青布头巾");
  expect(out).toContain("这酒好生有劲");
  expect(out).toContain("首帧承接");
});

test("定妆图按台词点名挑选", () => {
  expect(pickCastImageIds([wu], "武松打虎")).toEqual(["img-wu"]);
  expect(pickCastImageIds([{ ...wu, name: "西门" }], "武松打虎")).toEqual(["img-wu"]);
});

test("镜头时长夹在 3 到 8 秒", () => {
  expect(shotDurationSec({ startSec: 0, endSec: 2 })).toBe(3);
  expect(shotDurationSec({ startSec: 0, endSec: 20 })).toBe(8);
});
