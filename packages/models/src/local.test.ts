import { expect, test } from "bun:test";
import { endpointOptionLabel } from "./index";
import { isLocalBaseUrl, localZeroPrices, originRoot } from "./local";

test("本机和局域网算本地，公网不算", () => {
  expect(isLocalBaseUrl("http://127.0.0.1:11434/v1")).toBe(true);
  expect(isLocalBaseUrl("http://localhost:1234/v1")).toBe(true);
  expect(isLocalBaseUrl("http://192.168.1.8:8188")).toBe(true);
  expect(isLocalBaseUrl("http://10.0.0.2:8080/v1")).toBe(true);
  expect(isLocalBaseUrl("https://api.deepseek.com/v1")).toBe(false);
});

test("本机单价默认是 0", () => {
  expect(localZeroPrices("llm")).toEqual({ priceInput: "0", priceOutput: "0" });
  expect(localZeroPrices("image")).toEqual({ priceImage: "0" });
});

test("Ollama 根地址要去掉 /v1", () => {
  expect(originRoot("http://127.0.0.1:11434/v1")).toBe("http://127.0.0.1:11434");
});

test("同名端点用模型 id 区分", () => {
  expect(endpointOptionLabel({ name: "通义万相视频", config: { model: "wan2.5-t2v-preview" } })).toBe(
    "通义万相视频 · wan2.5-t2v-preview",
  );
  expect(endpointOptionLabel({ name: "通义千问", config: { model: "qwen-plus" } })).toBe("通义千问 · qwen-plus");
  expect(endpointOptionLabel({ name: "Agnes 图片 · 2.5 Flash", config: { model: "2.5 Flash" } })).toBe(
    "Agnes 图片 · 2.5 Flash",
  );
});
