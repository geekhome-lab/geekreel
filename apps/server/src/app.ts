import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { createBunWebSocket } from "hono/bun";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { version, webDist } from "./config";
import { err, ok } from "./lib/resp";
import { wsHub, type WsLike } from "./ws";
import { projectsRoutes } from "./routes/projects";
import { assetsRoutes } from "./routes/assets";
import { jobsRoutes } from "./routes/jobs";
import { settingsRoutes } from "./routes/settings";
import { fsRoutes } from "./routes/fs";
import { modelsRoutes } from "./routes/models";
import { genRoutes } from "./routes/gen";
import { canvasRoutes } from "./routes/canvas";
import { timelineRoutes } from "./routes/timeline";
import { radarRoutes } from "./routes/radar";
import { pushRoutes } from "./routes/push";
import { analyzeRoutes } from "./routes/analyze";
import { remakeRoutes } from "./routes/remake";
import { stylesRoutes } from "./routes/styles";
import { pipelineRoutes } from "./routes/pipeline";
import { seriesRoutes } from "./routes/series";
import { composeRoutes } from "./routes/compose";

export const { upgradeWebSocket, websocket } = createBunWebSocket();

export function createApp() {
  const app = new Hono();

  app.use("/api/*", cors());

  app.get("/api/health", (c) => ok(c, { version, now: Date.now() }));

  app.route("/api/projects", projectsRoutes);
  app.route("/api/assets", assetsRoutes);
  app.route("/api/jobs", jobsRoutes);
  app.route("/api/settings", settingsRoutes);
  app.route("/api/fs", fsRoutes);
  app.route("/api/models", modelsRoutes);
  app.route("/api/gen", genRoutes);
  app.route("/api/canvas", canvasRoutes);
  app.route("/api/timeline", timelineRoutes);
  app.route("/api/radar", radarRoutes);
  app.route("/api/push", pushRoutes);
  app.route("/api/analyze", analyzeRoutes);
  app.route("/api/remake", remakeRoutes);
  app.route("/api/styles", stylesRoutes);
  app.route("/api/pipelines", pipelineRoutes);
  app.route("/api/series", seriesRoutes);
  app.route("/api/compose", composeRoutes);

  app.get(
    "/ws",
    upgradeWebSocket(() => ({
      onOpen(_evt, ws) {
        wsHub.add((ws.raw ?? ws) as unknown as WsLike);
      },
      onClose(_evt, ws) {
        wsHub.remove((ws.raw ?? ws) as unknown as WsLike);
      },
    })),
  );

  // 生产模式：托管 web 构建产物；SPA 回退放在 notFound 里，
  // 避免与 dist/assets 目录同名路由（如 /assets）冲突
  const hasDist = existsSync(webDist);
  if (hasDist) {
    app.use("/*", serveStatic({ root: webDist }));
  }

  app.notFound((c) => {
    if (hasDist && c.req.method === "GET" && !c.req.path.startsWith("/api")) {
      return c.html(readFileSync(join(webDist, "index.html"), "utf-8"));
    }
    return err(c, "接口不存在", 404);
  });
  app.onError((e, c) => {
    console.error("[server]", e);
    return err(c, e.message || "服务器内部错误", 500);
  });

  return app;
}
