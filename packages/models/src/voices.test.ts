import { expect, test } from "bun:test";
import { VOICE_FAMILIES, voiceFamilyOf, voicesForConfig, voicesForFamily } from "./voices";

test("按渠道列出各自音色", () => {
  expect(voiceFamilyOf({ baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen3-tts-flash" })).toBe("qwen");
  expect(voiceFamilyOf({ baseUrl: "https://api.openai.com/v1", model: "tts-1" })).toBe("openai");
  expect(voiceFamilyOf({ baseUrl: "https://api.minimax.io/v1", model: "speech-2.5-hd-preview" })).toBe("minimax");
  expect(voiceFamilyOf({ baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-tts" })).toBe("doubao");
  expect(voicesForConfig({ baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen3-tts-flash" }).some((v) => v.id === "Ethan")).toBe(true);
  expect(voicesForConfig({ baseUrl: "https://api.minimax.io/v1", model: "speech-2.5-hd-preview" }).some((v) => v.id === "male-qn-qingse")).toBe(true);
  expect(voicesForConfig({ baseUrl: "https://api.openai.com/v1", model: "tts-1" }).some((v) => v.id === "alloy")).toBe(true);
  expect(VOICE_FAMILIES.map((f) => f.id)).toEqual(["qwen", "openai", "minimax", "doubao"]);
  expect(voicesForFamily("openai").some((v) => v.id === "nova")).toBe(true);
  expect(voicesForFamily("doubao").some((v) => v.id === "zh_female_shuangkuaisisi_moon_bigtts")).toBe(true);
  expect(voicesForFamily("minimax").length).toBeGreaterThan(20);
});
