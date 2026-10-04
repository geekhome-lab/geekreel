import { Hono } from "hono";
import { existsSync, mkdirSync } from "node:fs";
import type { PublicSettings } from "@vw/core";
import { detectBins } from "@vw/media";
import { dataDir, version } from "../config";
import { db } from "../db";
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

  setLibraryRoot(root);
  return ok(c, await publicSettings());
});
