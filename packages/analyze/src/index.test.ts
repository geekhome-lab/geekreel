import { expect, test } from "bun:test";
import { detectYtdlp, fallbackTemplate, looksLikeVideoUrl, parseAnalysisReport } from "./index";

test("parseAnalysisReport 抠围栏并补默认槽", () => {
  const doc = parseAnalysisReport(`废话
\`\`\`json
{"title":"街访","hook":{"startMs":0,"endMs":2500,"summary":"抛问题"},"shots":[{"startMs":0,"endMs":2500,"visual":"近景","line":"你知道吗"}],"viralFactors":["争议提问"]}
\`\`\``);
  expect(doc.title).toBe("街访");
  expect(doc.hook.endMs).toBe(2500);
  expect(doc.template.variables).toContain("主题");
  expect(doc.viralFactors[0]).toBe("争议提问");
});

test("looksLikeVideoUrl", () => {
  expect(looksLikeVideoUrl("https://v.douyin.com/xxx")).toBe(true);
  expect(looksLikeVideoUrl("不是链接")).toBe(false);
});

test("detectYtdlp 用项目自带二进制", () => {
  const hit = detectYtdlp(true);
  expect(hit.source).toBe("bundled");
  expect(hit.bin).toContain("packages/analyze/vendor/yt-dlp");
});

test("fallbackTemplate 按时长拆 3–5 镜", () => {
  expect(fallbackTemplate("t", 9000).slots.length).toBeGreaterThanOrEqual(3);
  expect(fallbackTemplate("t", 20000).slots.length).toBeLessThanOrEqual(5);
});
