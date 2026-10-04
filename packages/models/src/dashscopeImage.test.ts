import { expect, test } from "bun:test";
import { dashscopeImageSize, dashscopeOrigin, isDashScope } from "./dashscopeImage";

test("认出百炼域名", () => {
  expect(isDashScope("https://dashscope.aliyuncs.com/compatible-mode/v1")).toBe(true);
  expect(isDashScope("https://dashscope-intl.aliyuncs.com/compatible-mode/v1")).toBe(true);
  expect(isDashScope("https://api.openai.com/v1")).toBe(false);
});

test("从兼容地址抽出百炼主机", () => {
  expect(dashscopeOrigin("https://dashscope.aliyuncs.com/compatible-mode/v1")).toBe(
    "https://dashscope.aliyuncs.com",
  );
});

test("qwen-image 尺寸换成星号格式", () => {
  expect(dashscopeImageSize("qwen-image-plus", "1024x1024")).toBe("1328*1328");
  expect(dashscopeImageSize("qwen-image-plus", "1024x1536")).toBe("928*1664");
  expect(dashscopeImageSize("qwen-image-plus", "1536x1024")).toBe("1664*928");
  expect(dashscopeImageSize("wanx2.1-t2i-plus", "1024x1024")).toBe("1024*1024");
});
