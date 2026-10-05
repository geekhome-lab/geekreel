import { expect, test } from "bun:test";
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
