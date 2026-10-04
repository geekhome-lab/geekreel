import { expect, test } from "bun:test";
import { matchPreset, modelPresets } from "./presets";

test("点名模型按能力和模型名认已配置", () => {
  const agnes = modelPresets.find((p) => p.id === "agnes-image")!;
  expect(
    matchPreset(agnes, {
      capability: "image",
      adapterType: "openai-compatible",
      config: { baseUrl: "https://apihub.agnes-ai.com/v1/", model: "agnes-image-2.5-flash" },
    }),
  ).toBe(true);
  expect(
    matchPreset(agnes, {
      capability: "image",
      adapterType: "openai-compatible",
      config: { baseUrl: "https://apihub.agnes-ai.com/v1", model: "agnes-3.0-flash" },
    }),
  ).toBe(false);
});

test("常用预设覆盖文本图片视频配音", () => {
  expect(modelPresets.some((p) => p.capability === "llm" && p.id === "gemini-flash")).toBe(true);
  expect(modelPresets.some((p) => p.capability === "image" && p.id === "doubao-image")).toBe(true);
  expect(modelPresets.some((p) => p.capability === "video" && p.id === "qwen-video")).toBe(true);
  expect(modelPresets.some((p) => p.capability === "tts" && p.id === "qwen-tts")).toBe(true);
});
