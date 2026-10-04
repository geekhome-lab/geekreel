import { expect, test } from "bun:test";
import { analysisPrompt, detectYtdlp, extractCopyFromHtml, extractDouyinId, extractHashtags, fallbackTemplate, looksLikeVideoUrl, parseAnalysisReport } from "./index";

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

test("extractDouyinId 认分享链和 video 路径", () => {
  expect(extractDouyinId("https://www.douyin.com/video/7123456789012345678")).toBe("7123456789012345678");
  expect(extractDouyinId("https://www.douyin.com/share/video/7123456789012345678")).toBe("7123456789012345678");
  expect(extractDouyinId("https://www.douyin.com/discover?modal_id=7123456789012345678")).toBe("7123456789012345678");
});

test("extractCopyFromHtml 抠 og 和 RENDER_DATA 文案", () => {
  const payload = encodeURIComponent(JSON.stringify({
    app: {
      videoInfoRes: {
        item_list: [{
          desc: "10秒看完AI简史 #人工智能",
          author: { nickname: "科技君" },
          video: { duration: 10200 },
        }],
      },
    },
  }));
  const html = `<html><head>
<title>别的标题 - 抖音</title>
<meta property="og:title" content="10秒AI简史">
<meta property="og:description" content="短描述">
</head><body>
<script id="RENDER_DATA" type="application/json">${payload}</script>
</body></html>`;
  const copy = extractCopyFromHtml(html, "https://www.douyin.com/video/1");
  expect(copy.title).toBe("10秒AI简史");
  expect(copy.description).toContain("10秒看完AI简史");
  expect(copy.author).toBe("科技君");
  expect(copy.durationMs).toBe(10200);
  expect(copy.tags).toContain("人工智能");
});

test("extractHashtags 去标点", () => {
  expect(extractHashtags("钩子 #AI，结尾 #短视频!")).toEqual(["AI", "短视频"]);
});

test("analysisPrompt 带转写和抽帧时刻", () => {
  const p = analysisPrompt({
    title: "街访",
    durationMs: 12000,
    sourceUrl: "https://v.douyin.com/abc",
    frames: [{ tMs: 0 }, { tMs: 3000 }],
    transcript: "你知道吗，AI已经能写剧本了",
    withImages: true,
  });
  expect(p).toContain("你知道吗，AI已经能写剧本了");
  expect(p).toContain("0.0s");
  expect(p).toContain("已附上对应时刻的画面截图");
});
