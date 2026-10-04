import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ScriptDoc } from "@vw/core";
import { db } from "../db";

export function projectDirectory(projectId: string): string | null {
  const row = db.query("SELECT directory FROM projects WHERE id = ?").get(projectId) as { directory: string } | null;
  return row?.directory ?? null;
}

export function saveProjectScript(projectId: string, script: ScriptDoc): void {
  const dir = projectDirectory(projectId);
  if (!dir) throw new Error("项目不存在");
  mkdirSync(join(dir, "pipeline"), { recursive: true });
  writeFileSync(join(dir, "pipeline", "script.json"), JSON.stringify(script, null, 2));
}

export function loadProjectScript(projectId: string): ScriptDoc | null {
  const dir = projectDirectory(projectId);
  if (!dir) return null;
  const path = join(dir, "pipeline", "script.json");
  if (!existsSync(path)) return null;
  try {
    const doc = JSON.parse(readFileSync(path, "utf8")) as ScriptDoc;
    return doc.scenes?.length ? doc : null;
  } catch {
    return null;
  }
}
