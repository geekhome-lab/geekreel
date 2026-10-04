import { expect, test } from "bun:test";
import { clipNovel, looksLikeHttpUrl, stripHtml } from "./fetchNovel";

test("识别链接", () => {
  expect(looksLikeHttpUrl("https://example.com/book/1")).toBe(true);
  expect(looksLikeHttpUrl("一段小说")).toBe(false);
});

test("抽 html 正文", () => {
  const t = stripHtml("<html><title>x</title><p>第一段</p><script>evil()</script><p>第二段</p></html>");
  expect(t).toContain("第一段");
  expect(t).toContain("第二段");
  expect(t).not.toContain("evil");
});

test("超长截断", () => {
  const { clipped, text } = clipNovel("甲".repeat(30_000));
  expect(clipped).toBe(true);
  expect(text.length).toBe(20_000);
});
