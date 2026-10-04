import { Hono } from "hono";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../db";
import { err, newId, now, ok } from "../lib/resp";

/**
 * 画布文档：JSON 落盘在项目目录 canvas/ 下（原子写），库里存索引。
 * 文档结构：{ version, nodes, edges, viewport }（React Flow 受控数据）。
 */

interface CanvasRow {
  id: string;
  projectId: string;
  name: string;
  path: string;
  updatedAt: number;
}

function projectDir(projectId: string): string | null {
  const row = db.query("SELECT directory FROM projects WHERE id = ?").get(projectId) as { directory: string } | null;
  return row?.directory ?? null;
}

export const canvasRoutes = new Hono();

/** 项目下的画布列表；没有则自动建「主画布」 */
canvasRoutes.get("/project/:projectId", (c) => {
  const projectId = c.req.param("projectId");
  const dir = projectDir(projectId);
  if (!dir) return err(c, "项目不存在", 404);

  let rows = db
    .query("SELECT * FROM canvas_docs WHERE projectId = ? ORDER BY updatedAt DESC")
    .all(projectId) as CanvasRow[];

  if (rows.length === 0) {
    const id = newId();
    const relPath = "canvas/主画布.json";
    const abs = join(dir, relPath);
    mkdirSync(join(dir, "canvas"), { recursive: true });
    writeFileSync(abs, JSON.stringify({ version: 1, nodes: [], edges: [], viewport: null }, null, 2), "utf-8");
    db.run("INSERT INTO canvas_docs (id, projectId, name, path, updatedAt) VALUES (?, ?, ?, ?, ?)", [
      id, projectId, "主画布", relPath, now(),
    ]);
    rows = db.query("SELECT * FROM canvas_docs WHERE projectId = ?").all(projectId) as CanvasRow[];
  }
  return ok(c, rows);
});

canvasRoutes.get("/:id", (c) => {
  const row = db.query("SELECT * FROM canvas_docs WHERE id = ?").get(c.req.param("id")) as CanvasRow | null;
  if (!row) return err(c, "画布不存在", 404);
  const dir = projectDir(row.projectId);
  if (!dir) return err(c, "项目不存在", 404);
  const abs = join(dir, row.path);
  if (!existsSync(abs)) return err(c, "画布文件丢失", 404);
  try {
    return ok(c, { meta: row, doc: JSON.parse(readFileSync(abs, "utf-8")) as unknown });
  } catch {
    return err(c, "画布文件损坏", 500);
  }
});

/** 保存画布（原子写） */
canvasRoutes.put("/:id", async (c) => {
  const row = db.query("SELECT * FROM canvas_docs WHERE id = ?").get(c.req.param("id")) as CanvasRow | null;
  if (!row) return err(c, "画布不存在", 404);
  const dir = projectDir(row.projectId);
  if (!dir) return err(c, "项目不存在", 404);

  const body = (await c.req.json().catch(() => null)) as { doc?: unknown } | null;
  if (!body?.doc) return err(c, "缺少 doc");

  const abs = join(dir, row.path);
  const tmp = `${abs}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(body.doc), "utf-8");
  renameSync(tmp, abs);
  db.run("UPDATE canvas_docs SET updatedAt = ? WHERE id = ?", [now(), row.id]);
  return ok(c, { saved: true, updatedAt: now() });
});
