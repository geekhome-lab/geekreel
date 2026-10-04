import { Hono } from "hono";
import { existsSync, mkdirSync } from "node:fs";
import type { PublicSettings } from "@vw/core";
import { detectBins } from "@vw/media";
import { dataDir, version } from "../config";
import { db } from "../db";
import { jobQueue } from "../jobs/queue";
import { err, ok } from "../lib/resp";
import { libraryRoot, setLibraryRoot } from "../services/library";

export const settingsRoutes = new Hono();

async function publicSettings(): Promise<PublicSettings> {
  const bins = await detectBins();
  const count = db.query("SELECT COUNT(*) AS n FROM assets").get() as { n: number };
  return {
    libraryRoot: libraryRoot(),
    dataDir,
    version,
    ffmpeg: {
      available: bins.available,
      source: bins.source,
      ffmpeg: bins.ffmpeg,
      ffprobe: bins.ffprobe,
    },
    assetCount: count.n,
  };
}

settingsRoutes.get("/", async (c) => ok(c, await publicSettings()));

settingsRoutes.post("/reveal", (c) => {
  const root = libraryRoot();
  if (!existsSync(root)) return err(c, "目录不存在", 404);
  const proc =
    process.platform === "darwin"
      ? Bun.spawn(["open", root])
      : process.platform === "win32"
        ? Bun.spawn(["explorer", root])
        : Bun.spawn(["xdg-open", root]);
  return ok(c, { opened: true, pid: proc.pid });
});

settingsRoutes.put("/", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { libraryRoot?: string };
  const root = body.libraryRoot?.trim();
  if (!root) return err(c, "缺少 libraryRoot");
  if (!root.startsWith("/")) return err(c, "须为绝对路径");

  try {
    mkdirSync(root, { recursive: true });
  } catch {
    return err(c, "无法创建该目录，请检查权限");
  }
  if (!existsSync(root)) return err(c, "目录不存在");

  const old = libraryRoot();
  const count = db.query("SELECT COUNT(*) AS n FROM assets").get() as { n: number };
  if (old !== root && count.n > 0) {
    const job = jobQueue.submit("asset.migrate", { from: old, to: root });
    return ok(c, { ...(await publicSettings()), migrateJobId: job.id, message: "正在把旧文件搬到新目录，去任务中心看进度。" });
  }
  setLibraryRoot(root);
  return ok(c, await publicSettings());
});
