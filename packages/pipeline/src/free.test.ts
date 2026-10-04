import { expect, test } from "bun:test";
import { fallbackPlan, parseFreePlan } from "./free";

test("parseFreePlan 读 JSON", () => {
  const plan = parseFreePlan(
    `{"title":"打虎","summary":"武松遇虎","shots":[{"id":"S01","visual":"上冈","line":"酒家说有虎","imagePrompt":"酒旗"}]}`,
    "武松打虎",
  );
  expect(plan.title).toBe("打虎");
  expect(plan.shots[0]!.visual).toBe("上冈");
  expect(plan.shots.length).toBeGreaterThanOrEqual(3);
});

test("坏 JSON 走兜底三镜", () => {
  const plan = parseFreePlan("不是 json", "武松在景阳冈打虎");
  expect(plan.shots).toHaveLength(3);
  expect(plan.title).toContain("武松");
});

test("fallbackPlan 截标题", () => {
  expect(fallbackPlan("   ").title).toBe("未命名短片");
});
