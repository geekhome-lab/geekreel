import { expect, test } from "bun:test";
import { speakCharBudget } from "./dialogue";
import { dubFromVideoPrompt, dubStoryHint, isTalkingShot, lineFromClipSource, parseDubFromVideo } from "./dubMatch";

test("配音词只来自这一镜，不拼后面场次", () => {
  expect(
    lineFromClipSource({
      durationMs: 5000,
      line: "只剩一块八毛七。",
      visual: "德拉：只剩一块八毛七\n旁白：两人交换了圣诞礼物",
    }),
  ).toBe("只剩一块八毛七。");
  expect(
    lineFromClipSource({
      durationMs: 5000,
      visual: "德拉：只剩一块八毛七",
    }),
  ).toContain("一块八毛七");
});

test("看画面写词的提示带时长和字数，不把整份剧本塞进去", () => {
  const prompt = dubFromVideoPrompt({
    durationMs: 5000,
    visual: "德拉蹲在桌边数铜板",
    storyHint: "人物：德拉、吉姆",
    draft: "只剩一块八毛七",
  });
  expect(prompt).toContain("5.0 秒");
  expect(prompt).toContain("最多");
  expect(prompt).toContain("德拉蹲在桌边数铜板");
  expect(prompt).not.toContain("交换了圣诞礼物");
});

test("解析配音 JSON，超长按画面时长裁", () => {
  const parsed = parseDubFromVideo('{"line":"只剩一块八毛七。","silent":false}', 5000);
  expect(parsed.silent).toBe(false);
  expect(parsed.line).toContain("一块八毛七");
  const long = parseDubFromVideo(
    `{"line":"${"后面还有很长的情节，吉姆还没有礼物，德拉剪掉长发去卖，两人交换了圣诞礼物。".repeat(3)}","silent":false}`,
    5000,
  );
  expect(long.line.replace(/\s/g, "").length).toBeLessThanOrEqual(speakCharBudget(5000));
  expect(long.line).not.toContain("圣诞礼物");
  expect(parseDubFromVideo('{"line":"","silent":true}', 5000)).toEqual({ line: "", silent: true });
});

test("对白镜要对嘴，旁白和空镜只铺声", () => {
  expect(isTalkingShot({ line: "德拉：只剩一块八毛七。", visual: "特写，德拉数铜板" })).toBe(true);
  expect(isTalkingShot({ line: "只剩一块八毛七。", visual: "近景，德拉对着镜头" })).toBe(true);
  expect(isTalkingShot({ line: "旁白：圣诞节快到了。", visual: "大远景，城市夜色空镜" })).toBe(false);
  expect(isTalkingShot({ line: "", visual: "特写" })).toBe(false);
});

test("人物线索只留名字", () => {
  expect(
    dubStoryHint({
      title: "麦琪的礼物",
      scenes: [
        { lines: [{ speaker: "德拉", text: "只剩一块八毛七" }] },
        { lines: [{ speaker: "旁白", text: "两人交换了圣诞礼物" }] },
      ],
    }),
  ).toBe("剧名：麦琪的礼物。人物：德拉");
});
