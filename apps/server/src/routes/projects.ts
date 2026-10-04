import { Hono } from "hono";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Project } from "@vw/core";
import { db } from "../db";
import { err, newId, now, ok } from "../lib/resp";

function rowToProject(row: Record<string, unknown>): Project {
  return row as unknown as Project;
}

export const projectsRoutes = new Hono();

projectsRoutes.get("/", (c) => {
  const rows = db.query("SELECT * FROM projects ORDER BY updatedAt DESC").all() as Record<string, unknown>[];
  return ok(c, rows.map(rowToProject));
});

projectsRoutes.post("/", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { name?: string; directory?: string };
  const name = body.name?.trim();
  const directory = body.directory?.trim();
  if (!name) return err(c, "请填写项目名称");
  if (!directory) return err(c, "请选择项目目录");
  if (!directory.startsWith("/")) return err(c, "项目目录须为绝对路径");

  const dir = resolve(directory);
  const marker = join(dir, "project.vw.json");
  if (existsSync(marker)) return err(c, "该目录已是一个项目（存在 project.vw.json）");

  mkdirSync(join(dir, "canvas"), { recursive: true });
  mkdirSync(join(dir, "pipeline"), { recursive: true });
  mkdirSync(join(dir, "export"), { recursive: true });

  const id = newId();
  const t = now();
  writeFileSync(
    marker,
    JSON.stringify({ id, name, version: 1, createdAt: new Date(t).toISOString() }, null, 2),
    "utf-8",
  );
  db.run("INSERT INTO projects (id, name, directory, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)", [
    id, name, dir, t, t,
  ]);
  const row = db.query("SELECT * FROM projects WHERE id = ?").get(id) as Record<string, unknown>;
  return ok(c, rowToProject(row));
});

projectsRoutes.get("/:id", (c) => {
  const row = db.query("SELECT * FROM projects WHERE id = ?").get(c.req.param("id")) as Record<string, unknown> | null;
  if (!row) return err(c, "项目不存在", 404);
  return ok(c, rowToProject(row));
});

projectsRoutes.patch("/:id", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { name?: string };
  const name = body.name?.trim();
  if (!name) return err(c, "请填写项目名称");
  const id = c.req.param("id");
  const res = db.run("UPDATE projects SET name = ?, updatedAt = ? WHERE id = ?", [name, now(), id]);
  if (res.changes === 0) return err(c, "项目不存在", 404);
  const row = db.query("SELECT * FROM projects WHERE id = ?").get(id) as Record<string, unknown>;
  return ok(c, rowToProject(row));
});

/** 仅从列表移除，不删除磁盘文件 */
projectsRoutes.delete("/:id", (c) => {
  const res = db.run("DELETE FROM projects WHERE id = ?", [c.req.param("id")]);
  if (res.changes === 0) return err(c, "项目不存在", 404);
  return ok(c, { removed: true, filesKept: true });
});
