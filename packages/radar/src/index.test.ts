import { expect, test } from "bun:test";
import {
  buildFocusTemplate,
  inQuietHours,
  isDue,
  itemHash,
  matchSubscription,
  parseRadarResponse,
} from "./index";

test("parseRadarResponse 能抠 markdown 围栏", () => {
  const items = parseRadarResponse(
    '废话\n```json\n{"items":[{"title":"A","platform":"微博","url":"https://weibo.com/x","heat":88,"heatText":"热搜第2","summary":"摘要"}]}\n```',
    "微博",
  );
  expect(items).toHaveLength(1);
  expect(items[0]!.title).toBe("A");
  expect(items[0]!.heat).toBe(88);
});

test("parseRadarResponse 热度夹紧 + 缺字段兜底", () => {
  const items = parseRadarResponse('{"items":[{"title":"B","heat":999}]}', "抖音");
  expect(items[0]!.heat).toBe(100);
  expect(items[0]!.platform).toBe("抖音");
  expect(items[0]!.url).toBeNull();
});

test("itemHash 对空白和大小写不敏感", () => {
  expect(itemHash("Hello  World", "微博", null)).toBe(itemHash("hello world", "微博", null));
});

test("isDue 按间隔判断", () => {
  expect(isDue(null, 60)).toBe(true);
  expect(isDue(Date.now() - 10 * 60_000, 60)).toBe(false);
  expect(isDue(Date.now() - 70 * 60_000, 60)).toBe(true);
});

test("inQuietHours 支持跨夜", () => {
  const sub = { quietStart: 22, quietEnd: 8 };
  expect(inQuietHours(sub, new Date("2026-10-04T23:00:00"))).toBe(true);
  expect(inQuietHours(sub, new Date("2026-10-04T07:00:00"))).toBe(true);
  expect(inQuietHours(sub, new Date("2026-10-04T12:00:00"))).toBe(false);
});

test("matchSubscription 关键词 + 热度 + 平台", () => {
  const item = { title: "武松打虎上热搜", summary: "网友讨论", platform: "微博", heat: 80 };
  expect(matchSubscription(item, { keyword: "武松", platforms: [], heatThreshold: 50, enabled: true })).toBe(true);
  expect(matchSubscription(item, { keyword: "武松", platforms: ["抖音"], heatThreshold: 50, enabled: true })).toBe(false);
  expect(matchSubscription(item, { keyword: "武松", platforms: [], heatThreshold: 90, enabled: true })).toBe(false);
  expect(matchSubscription(item, { keyword: "无关", platforms: [], heatThreshold: 10, enabled: true })).toBe(false);
});

test("buildFocusTemplate 注入领域", () => {
  expect(buildFocusTemplate("电商")).toContain("电商");
});
