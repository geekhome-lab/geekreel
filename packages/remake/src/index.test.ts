import { expect, test } from "bun:test";
import { assembleSubtitleClips, lineDurationMs, parseRemakeShots } from "./index";

test("parseRemakeShots 按槽位对齐", () => {
  const tpl = {
    name: "t",
    variables: ["主题"],
    slots: [
      { id: "hook", maxSec: 3, shotDesc: "钩子", lineSlot: "问句" },
      { id: "cta", maxSec: 2, shotDesc: "结尾", lineSlot: "关注" },
    ],
  };
  const shots = parseRemakeShots(
    '{"shots":[{"slotId":"hook","line":"你还在用旧方法？","imagePrompt":"近景质问","maxSec":3},{"slotId":"cta","line":"点个关注","imagePrompt":"产品特写"}]}',
    tpl,
  );
  expect(shots).toHaveLength(2);
  expect(shots[0]!.line).toContain("旧方法");
  expect(shots[1]!.imagePrompt).toContain("字幕");
});

test("台词越长时长越长，不超过槽位上限", () => {
  expect(lineDurationMs("短", 5)).toBe(1200);
  expect(lineDurationMs("这是一句二十个汉字的旁白用来估时长", 5)).toBeGreaterThan(1200);
  expect(lineDurationMs("这是一句二十个汉字的旁白用来估时长再加上更多字", 3)).toBe(3000);
});

test("字幕按词级时长串起来", () => {
  const clips = assembleSubtitleClips([
    { line: "你好", imagePrompt: "近景", maxSec: 3 },
    { line: "下一句更长一些的台词", imagePrompt: "远景", maxSec: 5 },
  ]);
  expect(clips).toHaveLength(2);
  expect(clips[1]!.startMs).toBe(clips[0]!.durationMs);
});

test("有原镜时按原片时长对齐", () => {
  const clips = assembleSubtitleClips(
    [{ line: "新台词更长一些", imagePrompt: "近景", maxSec: 8 }],
    { originalShots: [{ startMs: 0, endMs: 2000, line: "旧" }] },
  );
  expect(clips[0]!.durationMs).toBeGreaterThan(2000);
  expect(clips[0]!.durationMs).toBeLessThanOrEqual(3600);
});

test("有词级时间戳时用词跨度", () => {
  const clips = assembleSubtitleClips(
    [{ line: "新", imagePrompt: "近景", maxSec: 8 }],
    {
      originalShots: [{ startMs: 1000, endMs: 4000, line: "旧台词" }],
      words: [
        { word: "旧", startMs: 1200, endMs: 1600 },
        { word: "台词", startMs: 1600, endMs: 2100 },
      ],
    },
  );
  expect(clips[0]!.durationMs).toBe(900);
});
