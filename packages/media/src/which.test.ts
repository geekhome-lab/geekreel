import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { whichBin } from "./which";

test("whichBin 能在 PATH 里找到 bun", () => {
  const hit = whichBin("bun");
  expect(hit).toBeTruthy();
  expect(existsSync(hit!)).toBe(true);
});
