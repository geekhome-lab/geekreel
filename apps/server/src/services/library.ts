import { existsSync, mkdirSync, renameSync, unlinkSync, copyFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import {
  buildAssetRelPath,
  parseAssetFileName,
  sanitizeTitle,
  type Asset,
  type AssetSource,
  type AssetType,
} from "@vw/core";
import { defaultLibraryRoot } from "../config";
import { db, getSetting, setSetting } from "../db";
import { newId, now } from "../lib/resp";
import { jobQueue } from "../jobs/queue";
import { wsHub } from "../ws";

// ---------------------------------------------------------------------------
// 资产库根目录
// ---------------------------------------------------------------------------

export function libraryRoot(): string {
  const root = getSetting<string>("libraryRoot", defaultLibraryRoot);
  mkdirSync(root, { recursive: true });
  return root;
}

export function setLibraryRoot(root: string) {
  mkdirSync(root, { recursive: true });
  setSetting("libraryRoot", root);
}

/** 相对路径 → 绝对路径，带越界保护 */
export function absInLibrary(rel: string): string {
  const root = resolve(libraryRoot());
  const abs = resolve(join(root, rel));
  if (abs !== root && !abs.startsWith(root + sep)) throw new Error("路径越界");
  return abs;
}

export function thumbAbs(assetId: string): string {
  return absInLibrary(join(".cache", "thumb", `${assetId}.jpg`));
}

export function proxyAbs(assetId: string): string {
  return absInLibrary(join(".cache", "proxy", `${assetId}.mp4`));
}

// ---------------------------------------------------------------------------
// 行 ↔ 对象
// ---------------------------------------------------------------------------

export function rowToAsset(row: Record<string, unknown>): Asset {
  return row as unknown as Asset;
}

export function getAsset(id: string): Asset | null {
  const row = db.query("SELECT * FROM assets WHERE id = ?").get(id) as Record<string, unknown> | null;
  return row ? rowToAsset(row) : null;
}

export function broadcastAsset(asset: Asset) {
  wsHub.broadcast({ type: "asset.upsert", asset });
}

// ---------------------------------------------------------------------------
// 入库
// ---------------------------------------------------------------------------

export interface StoreInput {
  type: AssetType;
  title: string;
  ext: string;
  source: AssetSource;
  projectId?: string | null;
  /** 二选一：内存数据 或 磁盘源文件（拷贝入库） */
  data?: Uint8Array | ArrayBuffer;
  fromPath?: string;
}

/** 资产入库：按 类型/年月/日期_标题_hash 落盘（原子写），建行，提交索引任务 */
export function storeAsset(input: StoreInput): Asset {
  const id = newId();
  const title = sanitizeTitle(input.title);
  const relPath = buildAssetRelPath({ type: input.type, title, id, ext: input.ext });
  const abs = absInLibrary(relPath);
  mkdirSync(dirname(abs), { recursive: true });

  const tmp = `${abs}.tmp-${process.pid}`;
  if (input.data !== undefined) {
    Bun.write(tmp, input.data);
  } else if (input.fromPath) {
    copyFileSync(input.fromPath, tmp);
  } else {
    throw new Error("缺少资产内容");
  }
  renameSync(tmp, abs);

  const sizeBytes = Bun.file(abs).size;
  const name = relPath.split("/").pop()!;
  db.run(
    `INSERT INTO assets (id, type, path, name, title, source, projectId, sizeBytes, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.type, relPath, name, title, input.source, input.projectId ?? null, sizeBytes, now()],
  );

  const asset = getAsset(id)!;
  broadcastAsset(asset);
  jobQueue.submit("asset.index", { assetId: id }, input.projectId ?? null);
  return asset;
}

// ---------------------------------------------------------------------------
// 重命名（同步改文件名的标题部分，目录与 hash 不变）
// ---------------------------------------------------------------------------

export function renameAsset(id: string, newTitle: string): Asset {
  const asset = getAsset(id);
  if (!asset) throw new Error("资产不存在");
  const parsed = parseAssetFileName(asset.name);
  const title = sanitizeTitle(newTitle);

  let relPath = asset.path;
  let name = asset.name;
  if (parsed) {
    const newName = `${parsed.mmdd}_${title}_${parsed.hash}.${parsed.ext}`;
    if (newName !== asset.name) {
      const newRel = join(dirname(asset.path), newName);
      const oldAbs = absInLibrary(asset.path);
      const newAbs = absInLibrary(newRel);
      if (existsSync(oldAbs)) renameSync(oldAbs, newAbs);
      relPath = newRel;
      name = newName;
    }
  }
  db.run("UPDATE assets SET title = ?, path = ?, name = ? WHERE id = ?", [title, relPath, name, id]);
  const next = getAsset(id)!;
  broadcastAsset(next);
  return next;
}

// ---------------------------------------------------------------------------
// 删除（含缓存文件）
// TODO(M2+)：画布/时间线上线后，删除前做引用检查
// ---------------------------------------------------------------------------

export function deleteAsset(id: string): boolean {
  const asset = getAsset(id);
  if (!asset) return false;
  for (const rel of [asset.path, asset.thumbPath, asset.proxyPath]) {
    if (!rel) continue;
    try {
      const abs = absInLibrary(rel);
      if (existsSync(abs)) unlinkSync(abs);
    } catch {
      /* 文件可能已不存在 */
    }
  }
  db.run("DELETE FROM assets WHERE id = ?", [id]);
  wsHub.broadcast({ type: "asset.remove", id });
  return true;
}

// ---------------------------------------------------------------------------
// 统计
// ---------------------------------------------------------------------------

export function assetStats() {
  const byType = db
    .query("SELECT type, COUNT(*) AS count, COALESCE(SUM(sizeBytes), 0) AS bytes FROM assets GROUP BY type")
    .all() as Array<{ type: AssetType; count: number; bytes: number }>;
  const byMonth = db
    .query(
      `SELECT strftime('%Y-%m', createdAt / 1000, 'unixepoch', 'localtime') AS month,
              COUNT(*) AS count, COALESCE(SUM(sizeBytes), 0) AS bytes
       FROM assets GROUP BY month ORDER BY month DESC`,
    )
    .all() as Array<{ month: string; count: number; bytes: number }>;
  const total = db.query("SELECT COUNT(*) AS count FROM assets").get() as { count: number };
  return { byType, byMonth, total: total.count };
}
