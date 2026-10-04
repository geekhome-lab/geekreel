import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync, copyFileSync, linkSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import {
  buildAssetRelPath,
  parseAssetFileName,
  sanitizeTitle,
  type Asset,
  type AssetKind,
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

export function tagsFor(assetId: string): string[] {
  return (db.query("SELECT tag FROM asset_tags WHERE assetId = ? ORDER BY tag").all(assetId) as Array<{ tag: string }>).map((r) => r.tag);
}

function tagsByIds(ids: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (ids.length === 0) return map;
  const ph = ids.map(() => "?").join(",");
  const rows = db.query(`SELECT assetId, tag FROM asset_tags WHERE assetId IN (${ph})`).all(...ids) as Array<{ assetId: string; tag: string }>;
  for (const r of rows) {
    const list = map.get(r.assetId) ?? [];
    list.push(r.tag);
    map.set(r.assetId, list);
  }
  return map;
}

export function rowToAsset(row: Record<string, unknown>, tags?: string[]): Asset {
  return {
    ...(row as unknown as Asset),
    favorite: Number(row.favorite) === 1,
    kind: ((row.kind as AssetKind) || "generic") as AssetKind,
    tags: tags ?? tagsFor(String(row.id)),
  };
}

export function hydrateAssets(rows: Record<string, unknown>[]): Asset[] {
  const tags = tagsByIds(rows.map((r) => String(r.id)));
  return rows.map((r) => rowToAsset(r, tags.get(String(r.id)) ?? []));
}

export function getAsset(id: string): Asset | null {
  const row = db.query("SELECT * FROM assets WHERE id = ?").get(id) as Record<string, unknown> | null;
  return row ? rowToAsset(row) : null;
}

export function updateAssetMeta(
  id: string,
  patch: { title?: string; favorite?: boolean; kind?: AssetKind; tags?: string[] },
): Asset {
  const asset = getAsset(id);
  if (!asset) throw new Error("资产不存在");
  if (patch.title?.trim() && patch.title.trim() !== asset.title) renameAsset(id, patch.title);
  if (patch.favorite !== undefined) {
    db.run("UPDATE assets SET favorite = ? WHERE id = ?", [patch.favorite ? 1 : 0, id]);
  }
  if (patch.kind) {
    db.run("UPDATE assets SET kind = ? WHERE id = ?", [patch.kind, id]);
  }
  if (patch.tags) {
    db.run("DELETE FROM asset_tags WHERE assetId = ?", [id]);
    const seen = new Set<string>();
    for (const raw of patch.tags) {
      const tag = raw.trim().slice(0, 24);
      if (!tag || seen.has(tag)) continue;
      seen.add(tag);
      db.run("INSERT INTO asset_tags (assetId, tag) VALUES (?, ?)", [id, tag]);
    }
  }
  const next = getAsset(id)!;
  broadcastAsset(next);
  return next;
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
  /** 三选一：内存数据 / 磁盘源文件（拷贝）/ 硬链接入库（零拷贝，同卷时） */
  data?: Uint8Array | ArrayBuffer;
  fromPath?: string;
  linkFromPath?: string;
}

/** 资产入库：按 类型/年月/日期_标题_hash 落盘（原子写），建行，提交索引任务 */
export function storeAsset(input: StoreInput): Asset {
  const id = newId();
  const title = sanitizeTitle(input.title);
  const relPath = buildAssetRelPath({ type: input.type, title, id, ext: input.ext });
  const abs = absInLibrary(relPath);
  mkdirSync(dirname(abs), { recursive: true });

  if (input.linkFromPath) {
    // 硬链接直接落在目标路径（同文件系统零拷贝）；失败由调用方回退拷贝
    linkSync(input.linkFromPath, abs);
  } else {
    const tmp = `${abs}.tmp-${process.pid}`;
    if (input.data !== undefined) {
      Bun.write(tmp, input.data);
    } else if (input.fromPath) {
      copyFileSync(input.fromPath, tmp);
    } else {
      throw new Error("缺少资产内容");
    }
    renameSync(tmp, abs);
  }

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
// ---------------------------------------------------------------------------

export interface AssetRef {
  projectId: string;
  projectName: string;
  kind: "canvas" | "timeline";
}

/** 画布/时间线还引用着就不能删 */
export function listAssetRefs(id: string): AssetRef[] {
  const refs: AssetRef[] = [];
  const projects = db.query("SELECT id, name, directory FROM projects").all() as Array<{
    id: string;
    name: string;
    directory: string;
  }>;
  for (const p of projects) {
    const timeline = join(p.directory, "timeline", "main.json");
    if (fileMentions(timeline, id)) refs.push({ projectId: p.id, projectName: p.name, kind: "timeline" });
    const canvasDir = join(p.directory, "canvas");
    if (existsSync(canvasDir) && statSync(canvasDir).isDirectory()) {
      for (const name of readdirSync(canvasDir)) {
        if (name.endsWith(".json") && fileMentions(join(canvasDir, name), id)) {
          refs.push({ projectId: p.id, projectName: p.name, kind: "canvas" });
          break;
        }
      }
    }
  }
  return refs;
}

export function countAssetRefs(id: string): number {
  return listAssetRefs(id).length;
}

function fileMentions(abs: string, id: string): boolean {
  if (!existsSync(abs)) return false;
  try {
    return readFileSync(abs, "utf8").includes(id);
  } catch {
    return false;
  }
}

export function deleteAsset(id: string): boolean {
  const refs = countAssetRefs(id);
  if (refs > 0) throw new Error("时间线或画布还在用这条素材，先撤下来再删");
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
  const big = db
    .query("SELECT id, title, type, sizeBytes FROM assets ORDER BY sizeBytes DESC LIMIT 8")
    .all() as Array<{ id: string; title: string; type: AssetType; sizeBytes: number }>;
  return { byType, byMonth, total: total.count, big };
}

export function clearLibraryCache(): { deleted: boolean; path: string } {
  const path = join(libraryRoot(), ".cache");
  if (existsSync(path)) rmSync(path, { recursive: true, force: true });
  return { deleted: true, path };
}
