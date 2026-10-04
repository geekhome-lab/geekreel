import { detectBins } from "@vw/media";
import { createApp, websocket } from "./app";
import { host, port } from "./config";
import { jobQueue } from "./jobs/queue";
import { indexAssetHandler } from "./services/indexer";
import { genImageHandler } from "./services/generate";
import { renderTimelineHandler } from "./services/render";
import { fetchRadarHandler, digestRadarHandler, seedRadarSources } from "./services/radar";
import { startRadarScheduler } from "./services/scheduler";
import { analyzeRunHandler } from "./services/analyze";
import { remakeRunHandler } from "./services/remake";
import { libraryRoot } from "./services/library";
import { detectYtdlp } from "@vw/analyze";

// 注册任务处理器
jobQueue.register("asset.index", indexAssetHandler, 2);
jobQueue.register("gen.image", genImageHandler, 4);
jobQueue.register("timeline.render", renderTimelineHandler, 2);
jobQueue.register("radar.fetch", fetchRadarHandler, 2);
jobQueue.register("radar.digest", digestRadarHandler, 1);
jobQueue.register("analyze.run", analyzeRunHandler, 1);
jobQueue.register("remake.run", remakeRunHandler, 2);
jobQueue.recover();
seedRadarSources();
startRadarScheduler();

const bins = await detectBins();
const app = createApp();

// hono/bun 的 upgradeWebSocket 会在 /ws 路由内部完成升级，
// 这里直接把 server 实例透传给 app.fetch 即可
Bun.serve({
  port,
  hostname: host,
  fetch: app.fetch,
  websocket,
});

console.log(`[vw] 视频工作台 server 已启动: http://${host}:${port}`);
console.log(`[vw] 资产库根目录: ${libraryRoot()}`);
console.log(`[vw] ffmpeg: ${bins.available ? `${bins.ffmpeg} (${bins.source})` : "未检测到 —— 缩略图/代理不可用，安装后重启生效"}`);
const ytdlp = detectYtdlp();
console.log(`[vw] yt-dlp: ${ytdlp.bin ? `${ytdlp.bin} (${ytdlp.source})` : "未打包 —— 将在首次分析时写入 vendor/，或从资产库分析"}`);
