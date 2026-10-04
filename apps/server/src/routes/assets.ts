import { Hono } from "hono";
import { existsSync, statSync } from "node:fs";
import type { SQLQueryBindings } from "bun:sqlite";
import { assetTypeFromExt, extFromFileName, mimeFromExt, type AssetKind, type AssetType } from "@vw/core";
import { db } from "../db";
import { err, ok } from "../lib/resp";
import {
  absInLibrary,
  assetStats,
  clearLibraryCache,
  deleteAsset,
  getAsset,
  hydrateAssets,
  listAssetFolders,
  listAssetRefs,
  renameAsset,
  storeAsset,
  updateAssetMeta,
} from "../services/library";

export const assetsRoutes = new Hono();

/** 列表：类型 / 月份 / 关键词 / 项目 过滤 */
assetsRoutes.get("/", (c) => {
  const type = c.req.query("type");
  const month = c.req.query("month");
  const folder = c.req.query("folder")?.trim();
  const q = c.req.query("q")?.trim();
  const projectId = c.req.query("projectId");
  const kind = c.req.query("kind");
  const source = c.req.query("source");
  const favorite = c.req.query("favorite");
  const tag = c.req.query("tag")?.trim();

  const where: string[] = [];
  const params: SQLQueryBindings[] = [];
  if (type) { where.push("type = ?"); params.push(type); }
  if (month) { where.push("path LIKE ?"); params.push(`%/${month}/%`); }
  if (folder) {
    if (folder === "未归类") {
      where.push("path NOT LIKE 'works/%'");
    } else if (folder.startsWith("未归类/")) {
      const t = folder.slice("未归类/".length);
      where.push("path LIKE ? AND path NOT LIKE 'works/%'");
      params.push(`${t}/%`);
    } else {
      where.push("path LIKE ?");
      params.push(`${folder}/%`);
    }
  }
  if (q) { where.push("(title LIKE ? OR id IN (SELECT assetId FROM asset_tags WHERE tag LIKE ?))"); params.push(`%${q}%`, `%${q}%`); }
  if (projectId) { where.push("projectId = ?"); params.push(projectId); }
  if (kind) { where.push("kind = ?"); params.push(kind); }
  if (source) { where.push("source = ?"); params.push(source); }
  if (favorite === "1") { where.push("favorite = 1"); }
  if (tag) { where.push("id IN (SELECT assetId FROM asset_tags WHERE tag = ?)"); params.push(tag); }

  const sql = `SELECT * FROM assets ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY favorite DESC, createdAt DESC`;
  const rows = db.query(sql).all(...params) as Record<string, unknown>[];
  return ok(c, hydrateAssets(rows));
});

assetsRoutes.get("/stats", (c) => ok(c, assetStats()));

assetsRoutes.get("/folders", (c) => ok(c, listAssetFolders()));

assetsRoutes.post("/batch", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { ids?: string[]; action?: string };
  const ids = (body.ids ?? []).filter(Boolean);
  if (ids.length === 0) return err(c, "先勾几条");
  if (body.action !== "delete") return err(c, "现在只能批量删除");
  let deleted = 0;
  const blocked: string[] = [];
  for (const id of ids) {
    try {
      if (deleteAsset(id)) deleted += 1;
    } catch {
      blocked.push(id);
    }
  }
  return ok(c, { deleted, blocked });
});

assetsRoutes.post("/cache/clear", (c) => ok(c, clearLibraryCache()));

/** 上传导入（multipart，字段 files 可多文件） */
assetsRoutes.post("/import", async (c) => {
  const body = await c.req.parseBody();
  const projectId = typeof body.projectId === "string" ? body.projectId : null;
  const raw = body["files"];
  const files = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(
    (f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f,
  );
  if (files.length === 0) return err(c, "未收到文件");

  const imported = [];
  const skipped: string[] = [];
  for (const file of files) {
    const ext = extFromFileName(file.name);
    const type: AssetType | null = assetTypeFromExt(ext);
    if (!type) {
      skipped.push(file.name);
      continue;
    }
    const title = file.name.replace(/\.[a-z0-9]+$/i, "");
    const asset = storeAsset({
      type,
      title,
      ext,
      source: "import",
      projectId,
      data: await file.arrayBuffer(),
    });
    imported.push(asset);
  }
  return ok(c, { imported, skipped });
});

/** 从本机路径导入（拷贝入库），适合大文件免上传 */
assetsRoutes.post("/import-path", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { paths?: string[]; projectId?: string };
  const paths = body.paths ?? [];
  if (paths.length === 0) return err(c, "未提供路径");

  const imported = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  for (const p of paths) {
    if (!existsSync(p)) {
      skipped.push({ path: p, reason: "文件不存在" });
      continue;
    }
    const fileName = p.split("/").pop()!;
    const ext = extFromFileName(fileName);
    const type = assetTypeFromExt(ext);
    if (!type) {
      skipped.push({ path: p, reason: "不支持的格式" });
      continue;
    }
    const asset = storeAsset({
      type,
      title: fileName.replace(/\.[a-z0-9]+$/i, ""),
      ext,
      source: "import",
      projectId: body.projectId ?? null,
      fromPath: p,
    });
    imported.push(asset);
  }
  return ok(c, { imported, skipped });
});

assetsRoutes.get("/:id/refs", (c) => ok(c, listAssetRefs(c.req.param("id"))));

assetsRoutes.get("/:id", (c) => {
  const asset = getAsset(c.req.param("id"));
  if (!asset) return err(c, "资产不存在", 404);
  return ok(c, asset);
});

assetsRoutes.patch("/:id", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    title?: string;
    favorite?: boolean;
    kind?: AssetKind;
    tags?: string[];
  };
  if (!body.title && body.favorite === undefined && !body.kind && !body.tags) {
    return err(c, "没有要改的内容");
  }
  try {
    if (body.title?.trim() && body.favorite === undefined && !body.kind && !body.tags) {
      return ok(c, renameAsset(c.req.param("id"), body.title));
    }
    return ok(c, updateAssetMeta(c.req.param("id"), body));
  } catch (e) {
    return err(c, e instanceof Error ? e.message : String(e), 404);
  }
});

assetsRoutes.delete("/:id", (c) => {
  try {
    if (!deleteAsset(c.req.param("id"))) return err(c, "资产不存在", 404);
    return ok(c, { deleted: true });
  } catch (e) {
    return err(c, e instanceof Error ? e.message : String(e), 409);
  }
});

assetsRoutes.post("/:id/reveal", (c) => {
  const asset = getAsset(c.req.param("id"));
  if (!asset) return err(c, "资产不存在", 404);
  const abs = absInLibrary(asset.path);
  if (!existsSync(abs)) return err(c, "文件不存在", 404);
  const proc =
    process.platform === "darwin"
      ? Bun.spawn(["open", "-R", abs])
      : process.platform === "win32"
        ? Bun.spawn(["explorer", `/select,${abs}`])
        : Bun.spawn(["xdg-open", abs]);
  return ok(c, { opened: true, pid: proc.pid });
});

/** 取文件：variant = original | thumb | proxy，支持 Range（视频拖动播放） */
assetsRoutes.get("/:id/file", async (c) => {
  const asset = getAsset(c.req.param("id"));
  if (!asset) return err(c, "资产不存在", 404);

  const variant = c.req.query("variant") ?? "original";
  const rel = variant === "thumb" ? asset.thumbPath : variant === "proxy" ? asset.proxyPath : asset.path;
  if (!rel) return err(c, "该变体不存在", 404);

  const abs = absInLibrary(rel);
  if (!existsSync(abs)) return err(c, "文件不存在", 404);

  const ext = extFromFileName(rel);
  const mime = mimeFromExt(ext);
  const size = statSync(abs).size;
  const range = c.req.header("range");

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = 0;
    let end = size - 1;
    if (m) {
      if (m[1] === "" && m[2]) {
        start = Math.max(0, size - Number(m[2]));
      } else {
        start = m[1] ? Number(m[1]) : 0;
        end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      }
    }
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    return new Response(Bun.file(abs).slice(start, end + 1), {
      status: 206,
      headers: {
        "Content-Type": mime,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
      },
    });
  }

  return new Response(Bun.file(abs), {
    headers: { "Content-Type": mime, "Content-Length": String(size), "Accept-Ranges": "bytes" },
  });
});
