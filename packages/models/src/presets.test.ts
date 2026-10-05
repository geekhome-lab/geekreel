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

test("本机 Ollama 和 ComfyUI 是可选项，不要密钥也能加", () => {
  const ollama = modelPresets.find((p) => p.id === "ollama-llm")!;
  const comfy = modelPresets.find((p) => p.id === "comfyui-image")!;
  expect(ollama.local).toBe(true);
  expect(ollama.secretKeys).toEqual([]);
  expect(comfy.adapterType).toBe("comfyui");
  expect(comfy.secretKeys).toEqual([]);
  expect(
    matchPreset(ollama, {
      capability: "llm",
      adapterType: "openai-compatible",
      config: { baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.1" },
    }),
  ).toBe(true);
});
