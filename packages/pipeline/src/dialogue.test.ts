import { expect, test } from "bun:test";
import { buildFinishTimeline, cuesFromScenes, extractDialogue, fitCuesToClips, spokenLine, splitSpokenCues, wrapSubtitle } from "./dialogue";

test("抽出角色冒号后的台词，丢掉风格锁", () => {
  const text = [
    "【画面风格，必须遵守】手绘白板",
    "角色锁定「德拉」：必须同一张脸",
    "0:00–0:08（8秒）",
    "德拉清点积蓄",
    "德拉：只剩一块八毛七",
    "旁白：圣诞节快到了",
  ].join("\n");
  expect(extractDialogue(text)).toBe("只剩一块八毛七\n圣诞节快到了");
});

test("一场戏的台词拼在一起", () => {
  expect(
    spokenLine({
      lines: [
        { text: "只剩一块八毛七" },
        { text: "  " },
        { text: "可吉姆还没有礼物" },
      ],
    }),
  ).toBe("只剩一块八毛七\n可吉姆还没有礼物");
  expect(spokenLine({ lines: [], heading: "序幕·少年策马" })).toBe("少年策马");
});

test("装时间线：有配音就静掉原片声，字幕跟台词", () => {
  const doc = buildFinishTimeline(
    [
      { videoAssetId: "v1", durationMs: 5000, line: "只剩一块八毛七" },
      { videoAssetId: "v2", durationMs: 8000, line: "" },
    ],
    {
      withSubtitles: true,
      dubbed: [
        { assetId: "a1", durationMs: 2200 },
        { assetId: "", durationMs: 0 },
      ],
    },
  );
  const v = doc.tracks.find((t) => t.type === "video")!.clips;
  const a = doc.tracks.find((t) => t.type === "audio")!.clips;
  const s = doc.tracks.find((t) => t.type === "subtitle")!.clips;
  expect(v).toHaveLength(2);
  expect(v[0]!.volume).toBe(0);
  expect(v[1]!.volume).toBe(1);
  expect(a).toHaveLength(1);
  expect(a[0]!.assetId).toBe("a1");
  expect(s).toHaveLength(1);
  expect(s[0]!.text).toBe("只剩一块八毛七");
});

test("长旁白拆成短字幕，不整篇糊在一格", () => {
  const cues = splitSpokenCues(
    "东汉末年，涿县街头。一个少年蹲在草席后面，卖鞋为生。他姓刘，叫刘备。他逢人就说，自己是中山靖王之后。",
    20_000,
  );
  expect(cues.length).toBeGreaterThan(3);
  expect(cues.every((c) => c.text.replace(/\n/g, "").length <= 22)).toBe(true);
  expect(cues[0]!.startMs).toBe(0);
  expect(cues.at(-1)!.startMs + cues.at(-1)!.durationMs).toBeGreaterThanOrEqual(19_000);
  expect(wrapSubtitle("一个少年蹲在草席后面，卖鞋为生过日子")).toContain("\n");
});

test("两条片子八场戏，字幕按时长铺满", () => {
  const scenes = [
    { heading: "一", action: "", lines: [{ id: "a", speaker: "旁白", text: "他卖鞋为生。" }], startSec: 0, endSec: 10 },
    { heading: "二", action: "", lines: [{ id: "b", speaker: "旁白", text: "三人结义。" }], startSec: 10, endSec: 20 },
    { heading: "三", action: "", lines: [{ id: "c", speaker: "旁白", text: "三顾茅庐。" }], startSec: 20, endSec: 30 },
  ];
  const fitted = fitCuesToClips(
    [
      { videoAssetId: "v1", durationMs: 4000, line: "他卖鞋为生。" },
      { videoAssetId: "v2", durationMs: 8000, line: "三人结义。" },
    ],
    scenes,
  );
  expect(fitted[0]!.cues?.some((c) => c.text.includes("卖鞋"))).toBe(true);
  expect(fitted[1]!.cues?.some((c) => c.text.includes("茅庐"))).toBe(true);
});

test("一场戏一条时间，一句一条字幕", () => {
  const cues = cuesFromScenes(
    [
      { heading: "一", action: "", lines: [{ id: "a", speaker: "旁白", text: "他卖鞋为生。" }], startSec: 0, endSec: 8 },
      { heading: "二", action: "", lines: [{ id: "b", speaker: "旁白", text: "三人结义。" }], startSec: 8, endSec: 16 },
    ],
    16_000,
  );
  expect(cues.length).toBeGreaterThanOrEqual(2);
  expect(cues.some((c) => c.text.includes("卖鞋"))).toBe(true);
  expect(cues.some((c) => c.text.includes("结义"))).toBe(true);
});

test("不配字幕就只装画面和音", () => {
  const doc = buildFinishTimeline([{ videoAssetId: "v1", durationMs: 4000, line: "你好" }], {
    withSubtitles: false,
    dubbed: [{ assetId: "a1", durationMs: 1200 }],
  });
  expect(doc.tracks.find((t) => t.type === "subtitle")!.clips).toHaveLength(0);
  expect(doc.tracks.find((t) => t.type === "audio")!.clips).toHaveLength(1);
});
