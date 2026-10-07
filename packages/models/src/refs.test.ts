import { expect, test } from "bun:test";
import { collectVideoImages } from "./blobs";

test("首帧尾帧和主体库去重后最多 9 张", () => {
  const a = { mime: "image/png", data: new Uint8Array([1, 2, 3]) };
  const b = { mime: "image/png", data: new Uint8Array([4, 5, 6]) };
  const extras = Array.from({ length: 12 }, (_, i) => ({
    mime: "image/png",
    data: new Uint8Array([10, i + 1, 30 + i]),
  }));
  const all = collectVideoImages({ image: a, lastFrame: a, refs: [a, b, ...extras] });
  expect(all[0]).toBe(a);
  expect(all[1]).toBe(b);
  expect(all).toHaveLength(9);
});
