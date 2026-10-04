import { expect, test } from "bun:test";
import { fallbackBible, parseDramaBible, stitchEpisodeFrames } from "./index";

test("parseDramaBible 抠围栏并补足 5 集", () => {
  const doc = parseDramaBible(
    '废话 ```json {"title":"武松","episodes":[{"index":1,"title":"上山","shots":[{"startSec":0,"endSec":5,"visual":"酒店","imagePrompt":"酒店门口"}]}]} ```',
    "武松打虎",
  );
  expect(doc.title).toBe("武松");
  expect(doc.episodes).toHaveLength(5);
  expect(doc.episodes[0]!.shots.length).toBeGreaterThan(0);
  expect(doc.palette.colors.length).toBeGreaterThan(0);
});

test("JSON 坏了走 5 集兜底", () => {
  const doc = fallbackBible("景阳冈武松打虎");
  expect(doc.episodes).toHaveLength(5);
  expect(doc.episodes.every((e) => e.shots.length === 3)).toBe(true);
});

test("尾帧接到下一集第一镜", () => {
  const base = fallbackBible("打虎");
  base.episodes[0]!.lastFrame = "吊睛白额虎扑来";
  const stitched = stitchEpisodeFrames(base);
  expect(stitched.episodes[1]!.shots[0]!.imagePrompt).toContain("吊睛白额虎扑来");
});
