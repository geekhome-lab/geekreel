import "@vw/models/register";
import { detectBins } from "@vw/media";
import { createApp, websocket } from "./app";
import { host, port } from "./config";
import { jobQueue } from "./jobs/queue";
import { indexAssetHandler } from "./services/indexer";
import { genImageHandler, genTtsHandler, genVideoHandler, mediaTranscodeHandler, timelineTtsHandler } from "./services/generate";
import { migrateLibraryHandler } from "./services/migrate";
import { renderTimelineHandler } from "./services/render";
import { fetchRadarHandler, digestRadarHandler, seedRadarSources } from "./services/radar";
import { startRadarScheduler } from "./services/scheduler";
import { analyzeRunHandler } from "./services/analyze";
import { remakeRunHandler } from "./services/remake";
import { pipelineRunHandler } from "./services/pipeline";
import { listPacks } from "./services/styles";
import { styleImportHandler } from "./services/styleImport";
import { libraryRoot } from "./services/library";
import { detectYtdlp } from "@vw/analyze";

// 注册任务处理器
jobQueue.register("asset.index", indexAssetHandler, 2);
jobQueue.register("gen.image", genImageHandler, 4);
jobQueue.register("gen.video", genVideoHandler, 2);
jobQueue.register("gen.tts", genTtsHandler, 2);
jobQueue.register("media.transcode", mediaTranscodeHandler, 2);
jobQueue.register("timeline.tts", timelineTtsHandler, 1);
jobQueue.register("asset.migrate", migrateLibraryHandler, 1);
jobQueue.register("timeline.render", renderTimelineHandler, 2);
jobQueue.register("radar.fetch", fetchRadarHandler, 2);
jobQueue.register("radar.digest", digestRadarHandler, 1);
jobQueue.register("analyze.run", analyzeRunHandler, 1);
jobQueue.register("remake.run", remakeRunHandler, 2);
jobQueue.register("pipeline.run", pipelineRunHandler, 1);
jobQueue.register("style.import", styleImportHandler, 2);
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
const packs = listPacks();
console.log(`[vw] 风格包: ${packs.map((p) => `${p.name}${p.ready ? "" : "(未开放)"}`).join("、") || "无"}`);
