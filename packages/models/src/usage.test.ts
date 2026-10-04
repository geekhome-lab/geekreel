import { expect, test } from "bun:test";
import { computeCost, estimateTokens, parsePrice } from "./index";

test("中文按字估 token", () => {
  expect(estimateTokens("你好世界")).toBeGreaterThanOrEqual(2);
  expect(estimateTokens("hello world")).toBeGreaterThanOrEqual(2);
});

test("没填单价成本为 0", () => {
  expect(computeCost({ config: {}, promptTokens: 1000, completionTokens: 500 })).toBe(0);
});

test("按千 tokens 和按张计价", () => {
  expect(
    computeCost({
      config: { priceInput: "1", priceOutput: "2", priceImage: "0.2" },
      promptTokens: 1000,
      completionTokens: 500,
      images: 2,
    }),
  ).toBe(2.4);
});

test("非法单价当 0", () => {
  expect(parsePrice("abc")).toBe(0);
  expect(parsePrice("-1")).toBe(0);
});
