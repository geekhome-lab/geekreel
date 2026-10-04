import { expect, test } from "bun:test";
import { isPlaceholderSecret, maskSecret } from "./crypto";

test("打码和空值不能当新密钥", () => {
  expect(isPlaceholderSecret("")).toBe(true);
  expect(isPlaceholderSecret("****")).toBe(true);
  expect(isPlaceholderSecret(maskSecret("sk-abcdefghijklmnopqrstuvwxyz"))).toBe(true);
  expect(isPlaceholderSecret("sk-example-real-key-not-masked")).toBe(false);
});
