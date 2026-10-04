import type { DramaBible, Series, SeriesKind } from "@vw/core";
import { db } from "../db";
import { newId, now } from "../lib/resp";

interface SeriesRow {
  id: string;
  name: string;
  kind: string;
  stylePackId: string | null;
  substyle: string | null;
  paletteJson: string | null;
  bibleJson: string | null;
  episodeCount: number;
  lastProjectId: string | null;
  createdAt: number;
  updatedAt: number;
}

function rowToSeries(row: SeriesRow): Series {
  return row as unknown as Series;
}

export function listSeries(): Series[] {
  return (db.query("SELECT * FROM series ORDER BY updatedAt DESC").all() as SeriesRow[]).map(rowToSeries);
}

export function listSeriesPage(q: string, page: number, pageSize: number): { items: Series[]; total: number; page: number; pageSize: number } {
  const needle = q.trim();
  const where = needle ? "WHERE name LIKE ?" : "";
  const params = needle ? [`%${needle}%`] : [];
  const total = (db.query(`SELECT COUNT(*) AS n FROM series ${where}`).get(...params) as { n: number }).n;
  const offset = Math.max(page - 1, 0) * pageSize;
  const items = (
    db.query(`SELECT * FROM series ${where} ORDER BY updatedAt DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset) as SeriesRow[]
  ).map(rowToSeries);
  return { items, total, page, pageSize };
}

export function getSeries(id: string): Series | null {
  const row = db.query("SELECT * FROM series WHERE id = ?").get(id) as SeriesRow | null;
  return row ? rowToSeries(row) : null;
}

export function createSeries(input: {
  name: string;
  kind: SeriesKind;
  stylePackId?: string | null;
  substyle?: string | null;
}): Series {
  const id = newId();
  const t = now();
  db.run(
    `INSERT INTO series (id, name, kind, stylePackId, substyle, paletteJson, bibleJson, episodeCount, lastProjectId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, 0, NULL, ?, ?)`,
    [id, input.name.trim(), input.kind, input.stylePackId ?? null, input.substyle ?? null, t, t],
  );
  return getSeries(id)!;
}

export function seriesBible(s: Series): DramaBible | null {
  if (!s.bibleJson) return null;
  try {
    return JSON.parse(s.bibleJson) as DramaBible;
  } catch {
    return null;
  }
}

export function seriesDetail(id: string): (Series & { bible: DramaBible | null }) | null {
  const s = getSeries(id);
  if (!s) return null;
  return { ...s, bible: seriesBible(s) };
}

export function deleteSeries(id: string): boolean {
  const s = getSeries(id);
  if (!s) return false;
  db.run("UPDATE projects SET seriesId = NULL, episodeIndex = NULL WHERE seriesId = ?", [id]);
  return db.run("DELETE FROM series WHERE id = ?", [id]).changes > 0;
}

export function ensureProjectSeries(projectId: string, name: string, kind: SeriesKind = "free") {
  const row = db.query("SELECT seriesId FROM projects WHERE id = ?").get(projectId) as { seriesId: string | null } | null;
  if (!row) throw new Error("项目不存在");
  if (row.seriesId) return getSeries(row.seriesId);
  const series = createSeries({ name: name.trim() || "未命名", kind });
  attachEpisode(series.id, projectId, null, null);
  return getSeries(series.id);
}

export function attachEpisode(seriesId: string, projectId: string, bible: DramaBible | null, paletteJson: string | null) {
  const s = getSeries(seriesId);
  if (!s) throw new Error("这部连载不存在");
  const next = s.episodeCount + 1;
  const t = now();
  db.run(
    `UPDATE series SET episodeCount = ?, lastProjectId = ?, bibleJson = ?, paletteJson = ?, stylePackId = COALESCE(stylePackId, ?),
     substyle = COALESCE(substyle, ?), updatedAt = ? WHERE id = ?`,
    [
      next,
      projectId,
      bible ? JSON.stringify(bible) : s.bibleJson,
      paletteJson ?? s.paletteJson,
      bible?.packId ?? null,
      bible?.substyle ?? null,
      t,
      seriesId,
    ],
  );
  db.run("UPDATE projects SET seriesId = ?, episodeIndex = ?, updatedAt = ? WHERE id = ?", [seriesId, next, t, projectId]);
  return next;
}
