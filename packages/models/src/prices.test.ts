import { expect, test } from "bun:test";
import {
  formatYuan,
  missingUnitPrice,
  pickDashScopeModel,
  pricesFromDashScopeModel,
  pricesFromOpenRouter,
  yuanPerThousandChars,
  yuanPerThousandTokens,
} from "./prices";

test("百万 tokens 换成元/千 tokens", () => {
  expect(yuanPerThousandTokens(2, "每百万tokens")).toBe(0.002);
  expect(yuanPerThousandTokens(8, "per million tokens")).toBe(0.008);
  expect(yuanPerThousandTokens(1, "元/千tokens")).toBe(1);
});

test("万字符换成元/千字", () => {
  expect(yuanPerThousandChars(0.8, "每万字符")).toBe(0.08);
  expect(yuanPerThousandChars(0.2, "每千字")).toBe(0.2);
});

test("百炼文本和出图报价", () => {
  const llm = pricesFromDashScopeModel({
    model: "qwen-plus",
    prices: [
      {
        range_name: "Default",
        prices: [
          { type: "input_token", price: "2", price_unit: "每百万tokens", price_name: "输入" },
          { type: "output_token", price: "8", price_unit: "每百万tokens", price_name: "输出" },
        ],
      },
    ],
  });
  expect(llm.priceInput).toBe("0.002");
  expect(llm.priceOutput).toBe("0.008");

  const img = pricesFromDashScopeModel({
    model: "qwen-image-plus",
    prices: [
      {
        range_name: "Default",
        prices: [{ type: "image_number", price: "0.075", price_unit: "每张", price_name: "图像生成" }],
      },
    ],
  });
  expect(img.priceImage).toBe("0.075");

  const vid = pricesFromDashScopeModel({
    model: "wan2.5-t2v-preview",
    prices: [
      {
        range_name: "Default",
        prices: [{ type: "video_duration", price: "0.6", price_unit: "每秒", price_name: "视频生成" }],
      },
    ],
  });
  expect(vid.priceVideo).toBe("0.6");
});

test("按模型 id 精确挑", () => {
  const hit = pickDashScopeModel(
    [
      { model: "qwen-plus-2025" },
      { model: "qwen-plus" },
    ],
    "qwen-plus",
  );
  expect(hit?.model).toBe("qwen-plus");
});

test("没填对应能力的单价算缺价", () => {
  expect(missingUnitPrice({ capability: "llm", config: {} })).toBe(true);
  expect(missingUnitPrice({ capability: "llm", config: { priceInput: "0.002" } })).toBe(false);
  expect(missingUnitPrice({ capability: "image", config: { priceImage: "0.1" } })).toBe(false);
  expect(missingUnitPrice({ capability: "llm", config: { baseUrl: "http://127.0.0.1:11434/v1" } })).toBe(false);
});

test("OpenRouter 美元按 7.2 折人民币", () => {
  const p = pricesFromOpenRouter({ prompt: "0.000002", completion: "0.000008" }, 7.2);
  expect(p.priceInput).toBe(formatYuan(0.000002 * 1000 * 7.2));
  expect(p.priceOutput).toBe(formatYuan(0.000008 * 1000 * 7.2));
});
