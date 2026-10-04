import { Hono } from "hono";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { sanitizeTitle, type Project } from "@vw/core";
import { db } from "../db";
import { err, newId, now, ok } from "../lib/resp";
import { libraryRoot } from "../services/library";

function rowToProject(row: Record<string, unknown>): Project {
  return row as unknown as Project;
}

export const projectsRoutes = new Hono();

projectsRoutes.get("/", (c) => {
  const rows = db.query("SELECT * FROM projects ORDER BY updatedAt DESC").all() as Record<string, unknown>[];
  return ok(c, rows.map(rowToProject));
});

projectsRoutes.post("/", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    directory?: string;
    allowNonEmpty?: boolean;
  };
  const name = body.name?.trim();
  const directory = body.directory?.trim();
  if (!name) return err(c, "请填写项目名称");
  if (!directory) return err(c, "请选择项目目录");
  if (!directory.startsWith("/")) return err(c, "项目目录须为绝对路径");

  const dir = resolve(directory);
  // 防呆：不允许把家目录/磁盘根目录当项目目录（会在里面建 canvas/pipeline/export 子目录）
  if (dir === homedir() || dir === "/" || dir === resolve("/")) {
    return err(c, "不能直接用家目录或根目录当项目目录，请新建一个子文件夹");
  }
  const marker = join(dir, "project.vw.json");
  if (existsSync(marker)) return err(c, "该目录已是一个项目（存在 project.vw.json）");
  // 防呆：非空目录需显式确认，避免把文件撒进别人的目录
  if (existsSync(dir) && !body.allowNonEmpty) {
    const entries = readdirSync(dir).filter((e) => !e.startsWith("."));
    if (entries.length > 0) return err(c, "该目录不是空目录，建议新建一个干净的子文件夹", 409);
  }

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

/**
 * 快速建项目（小白路径）：不问目录，自动建在 资产库/projects/ 下。
 * 目录名：MMDD_标题_hash，与资产命名规范一致。
 */
projectsRoutes.post("/quick", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { name?: string };
  const name = body.name?.trim() || "未命名项目";

  const id = newId();
  const d = new Date();
  const mmdd = `${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const hash = id.replace(/-/g, "").slice(0, 4);
  const dir = join(libraryRoot(), "projects", `${mmdd}_${sanitizeTitle(name, 24)}_${hash}`);

  mkdirSync(join(dir, "canvas"), { recursive: true });
  mkdirSync(join(dir, "pipeline"), { recursive: true });
  mkdirSync(join(dir, "export"), { recursive: true });

  const t = now();
  writeFileSync(
    join(dir, "project.vw.json"),
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
