import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

export const version = "0.1.0";
export const port = Number(process.env.VW_PORT ?? 4780);
export const host = process.env.VW_HOST ?? "127.0.0.1";

/** 全局数据目录：SQLite、缓存等 */
export const dataDir = process.env.VW_DATA_DIR ?? join(homedir(), ".video-workbench");
mkdirSync(dataDir, { recursive: true });

export const dbPath = join(dataDir, "vw.db");

/** 资产库默认根目录（用户可在设置中更改） */
export const defaultLibraryRoot = join(homedir(), "VideoWorkbench");

/** web 构建产物（生产模式下由 server 托管） */
export const webDist = new URL("../../web/dist", import.meta.url).pathname;
