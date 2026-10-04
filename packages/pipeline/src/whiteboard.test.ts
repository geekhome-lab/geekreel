import { expect, test } from "bun:test";
import { bibleFromWhiteboard, groupCuesIntoScenes, looksLikeSrt, scenesFromInput } from "./whiteboard";

const srt = `1
00:00:00,000 --> 00:00:08,000
先把问题说清楚

2
00:00:08,000 --> 00:00:16,000
再用一张图讲方法

3
00:00:16,000 --> 00:00:24,000
最后给行动
`;

test("looksLikeSrt", () => {
  expect(looksLikeSrt(srt)).toBe(true);
  expect(looksLikeSrt("就是一段口播")).toBe(false);
});

test("SRT 按约 30 秒收幕，并保留原字幕条", () => {
  const { cues, scenes } = scenesFromInput(srt);
  expect(cues).toHaveLength(3);
  expect(scenes.length).toBeGreaterThanOrEqual(1);
  expect(scenes[0]!.text).toContain("问题");
});

test("纯文案按行分幕", () => {
  const { scenes } = scenesFromInput("第一句口播\n第二句口播");
  expect(scenes).toHaveLength(2);
  expect(scenes[1]!.startMs).toBe(8000);
});

test("groupCues 超时会拆幕", () => {
  const scenes = groupCuesIntoScenes(
    [
      { startMs: 0, endMs: 20_000, text: "a" },
      { startMs: 20_000, endMs: 40_000, text: "b" },
    ],
    30_000,
  );
  expect(scenes.length).toBe(2);
});

test("圣经只有一集多镜", () => {
  const bible = bibleFromWhiteboard("口播", scenesFromInput("甲\n乙\n丙").scenes);
  expect(bible.episodes).toHaveLength(1);
  expect(bible.episodes[0]!.shots).toHaveLength(3);
});
