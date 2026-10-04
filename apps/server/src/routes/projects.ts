import { Hono } from "hono";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { sanitizeTitle, type Project, type ScriptDoc, type SeriesKind } from "@vw/core";
import { db } from "../db";
import { err, newId, now, ok } from "../lib/resp";
import { libraryRoot } from "../services/library";
import { attachEpisode, createSeries, ensureProjectSeries, getSeries } from "../services/series";
import { loadProjectScript, saveProjectScript } from "../services/scriptStore";

function rowToProject(row: Record<string, unknown>): Project {
  return row as unknown as Project;
}

export const projectsRoutes = new Hono();

projectsRoutes.get("/", (c) => {
  const sort = c.req.query("sort") === "created" ? "createdAt" : "updatedAt";
  const pageRaw = c.req.query("page");
  if (!pageRaw && !c.req.query("pageSize")) {
    const rows = db.query(`SELECT * FROM projects ORDER BY ${sort} DESC`).all() as Record<string, unknown>[];
    return ok(c, rows.map(rowToProject));
  }
  const page = Math.max(Number(pageRaw ?? 1) || 1, 1);
  const pageSize = Math.min(Math.max(Number(c.req.query("pageSize") ?? 12) || 12, 1), 50);
  const total = (db.query("SELECT COUNT(*) AS n FROM projects").get() as { n: number }).n;
  const rows = db
    .query(`SELECT * FROM projects ORDER BY ${sort} DESC LIMIT ? OFFSET ?`)
    .all(pageSize, (page - 1) * pageSize) as Record<string, unknown>[];
  return ok(c, { items: rows.map(rowToProject), total, page, pageSize, sort: sort === "createdAt" ? "created" : "updated" });
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
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    seriesId?: string;
    seriesName?: string;
    kind?: SeriesKind;
    stylePackId?: string;
    substyle?: string;
  };
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
  db.run("INSERT INTO projects (id, name, directory, stylePackId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)", [
    id, name, dir, body.stylePackId ?? null, t, t,
  ]);

  let seriesId = body.seriesId?.trim() || null;
  if (seriesId && !getSeries(seriesId)) return err(c, "这部连载不存在", 404);
  if (!seriesId && body.seriesName?.trim()) {
    seriesId = createSeries({
      name: body.seriesName.trim(),
      kind: body.kind === "whiteboard" ? "whiteboard" : body.kind === "drama" ? "drama" : "free",
      stylePackId: body.stylePackId,
      substyle: body.substyle,
    }).id;
  }
  if (seriesId) {
    const s = getSeries(seriesId);
    attachEpisode(seriesId, id, null, s?.paletteJson ?? null);
    if (s?.stylePackId) db.run("UPDATE projects SET stylePackId = ?, paletteJson = ? WHERE id = ?", [s.stylePackId, s.paletteJson, id]);
  }

  const row = db.query("SELECT * FROM projects WHERE id = ?").get(id) as Record<string, unknown>;
  return ok(c, rowToProject(row));
});

projectsRoutes.post("/:id/ensure-series", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { name?: string; kind?: SeriesKind };
  try {
    const series = ensureProjectSeries(
      c.req.param("id"),
      body.name?.trim() || "未命名",
      body.kind === "whiteboard" ? "whiteboard" : body.kind === "drama" ? "drama" : "free",
    );
    const row = db.query("SELECT * FROM projects WHERE id = ?").get(c.req.param("id")) as Record<string, unknown>;
    return ok(c, { project: rowToProject(row), series });
  } catch (e) {
    return err(c, e instanceof Error ? e.message : String(e), 404);
  }
});

projectsRoutes.get("/:id", (c) => {
  const row = db.query("SELECT * FROM projects WHERE id = ?").get(c.req.param("id")) as Record<string, unknown> | null;
  if (!row) return err(c, "项目不存在", 404);
  return ok(c, rowToProject(row));
});

projectsRoutes.put("/:id/script", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { script?: ScriptDoc };
  if (!body.script?.scenes?.length) return err(c, "没有可存的剧本");
  try {
    saveProjectScript(c.req.param("id"), body.script);
    return ok(c, { saved: true });
  } catch (e) {
    return err(c, e instanceof Error ? e.message : String(e), 404);
  }
});

projectsRoutes.get("/:id/script", (c) => {
  const script = loadProjectScript(c.req.param("id"));
  if (!script) return err(c, "这部还没有剧本", 404);
  return ok(c, { script });
});

projectsRoutes.patch("/:id", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { name?: string; stylePackId?: string | null };
  const id = c.req.param("id");
  const exists = db.query("SELECT id FROM projects WHERE id = ?").get(id);
  if (!exists) return err(c, "项目不存在", 404);
  const name = body.name?.trim();
  if (name) db.run("UPDATE projects SET name = ?, updatedAt = ? WHERE id = ?", [name, now(), id]);
  if ("stylePackId" in body) {
    db.run("UPDATE projects SET stylePackId = ?, updatedAt = ? WHERE id = ?", [body.stylePackId ?? null, now(), id]);
  }
  if (!name && !("stylePackId" in body)) return err(c, "请填写项目名称");
  const row = db.query("SELECT * FROM projects WHERE id = ?").get(id) as Record<string, unknown>;
  return ok(c, rowToProject(row));
});

/** 仅从列表移除，不删除磁盘文件 */
projectsRoutes.delete("/:id", (c) => {
  const res = db.run("DELETE FROM projects WHERE id = ?", [c.req.param("id")]);
  if (res.changes === 0) return err(c, "项目不存在", 404);
  return ok(c, { removed: true, filesKept: true });
});
