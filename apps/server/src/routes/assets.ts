import { Hono } from "hono";
import { existsSync, statSync } from "node:fs";
import type { SQLQueryBindings } from "bun:sqlite";
import { assetTypeFromExt, extFromFileName, mimeFromExt, type AssetType } from "@vw/core";
import { db } from "../db";
import { err, ok } from "../lib/resp";
import {
  absInLibrary,
  assetStats,
  deleteAsset,
  getAsset,
  renameAsset,
  rowToAsset,
  storeAsset,
} from "../services/library";

export const assetsRoutes = new Hono();

/** 列表：类型 / 月份 / 关键词 / 项目 过滤 */
assetsRoutes.get("/", (c) => {
  const type = c.req.query("type");
  const month = c.req.query("month");
  const q = c.req.query("q")?.trim();
  const projectId = c.req.query("projectId");

  const where: string[] = [];
  const params: SQLQueryBindings[] = [];
  if (type) { where.push("type = ?"); params.push(type); }
  if (month) { where.push("path LIKE ?"); params.push(`%/${month}/%`); }
  if (q) { where.push("title LIKE ?"); params.push(`%${q}%`); }
  if (projectId) { where.push("projectId = ?"); params.push(projectId); }

  const sql = `SELECT * FROM assets ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY createdAt DESC`;
  const rows = db.query(sql).all(...params) as Record<string, unknown>[];
  return ok(c, rows.map(rowToAsset));
});

assetsRoutes.get("/stats", (c) => ok(c, assetStats()));

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

assetsRoutes.get("/:id", (c) => {
  const asset = getAsset(c.req.param("id"));
  if (!asset) return err(c, "资产不存在", 404);
  return ok(c, asset);
});

assetsRoutes.patch("/:id", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { title?: string };
  if (!body.title?.trim()) return err(c, "请填写标题");
  try {
    return ok(c, renameAsset(c.req.param("id"), body.title));
  } catch (e) {
    return err(c, e instanceof Error ? e.message : String(e), 404);
  }
});

assetsRoutes.delete("/:id", (c) => {
  if (!deleteAsset(c.req.param("id"))) return err(c, "资产不存在", 404);
  return ok(c, { deleted: true });
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
