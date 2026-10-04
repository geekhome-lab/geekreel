import { expect, test } from "bun:test";
import { isDashScopeTts } from "./dashscopeTts";

test("认出百炼 TTS，不把兼容地址当 OpenAI 语音", () => {
  expect(
    isDashScopeTts({
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen3-tts-flash",
    }),
  ).toBe(true);
  expect(isDashScopeTts({ baseUrl: "https://api.openai.com/v1", model: "tts-1" })).toBe(false);
});
