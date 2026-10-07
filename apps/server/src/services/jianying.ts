import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import { buildJianyingDraft, sanitizeTitle, type JianyingMedia, type TimelineDoc } from "@vw/core";
import { db } from "../db";
import { absInLibrary } from "./library";

function projectRow(projectId: string): { directory: string; name: string } | null {
  return db.query("SELECT directory, name FROM projects WHERE id = ?").get(projectId) as
    | { directory: string; name: string }
    | null;
}

function collectMedia(doc: TimelineDoc): JianyingMedia[] {
  const ids = new Set<string>();
  for (const t of doc.tracks) {
    for (const c of t.clips) if (c.assetId) ids.add(c.assetId);
  }
  const out: JianyingMedia[] = [];
  for (const id of ids) {
    const row = db.query("SELECT id, title, type, path, durationMs FROM assets WHERE id = ?").get(id) as
      | { id: string; title: string; type: string; path: string; durationMs: number | null }
      | null;
    if (!row) continue;
    const type = row.type === "audio" ? "audio" : row.type === "image" ? "image" : "video";
    out.push({
      assetId: row.id,
      path: absInLibrary(row.path),
      title: row.title,
      type,
      durationMs: row.durationMs || 3000,
    });
  }
  return out;
}

function jianyingUserDrafts(): string | null {
  const candidates = [
    join(homedir(), "Movies/JianyingPro/User Data/Projects/com.lveditor.draft"),
    join(homedir(), "Movies/CapCut/User Data/Projects/com.lveditor.draft"),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

export function exportJianyingDraft(projectId: string): {
  draftDir: string;
  copiedToApp: string | null;
  hint: string;
} {
  const project = projectRow(projectId);
  if (!project) throw new Error("项目不存在");
  const timelinePath = join(project.directory, "timeline", "main.json");
  if (!existsSync(timelinePath)) throw new Error("时间线还是空的。先出这一集或从画布装上。");
  const doc = JSON.parse(readFileSync(timelinePath, "utf8")) as TimelineDoc;
  const media = collectMedia(doc);
  if (media.length === 0) throw new Error("时间线上还没有素材。");

  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const folderName = `${stamp}_${sanitizeTitle(project.name, 24)}`;
  const draftDir = join(project.directory, "export", "jianying", folderName);
  const materialsDir = join(draftDir, "materials");
  mkdirSync(materialsDir, { recursive: true });

  const relocated: JianyingMedia[] = media.map((m, i) => {
    const ext = extname(m.path) || (m.type === "audio" ? ".mp3" : m.type === "image" ? ".png" : ".mp4");
    const dest = join(materialsDir, `${i}_${sanitizeTitle(m.title, 16)}${ext}`);
    copyFileSync(m.path, dest);
    return { ...m, path: dest };
  });

  const files = buildJianyingDraft({ name: project.name, doc, media: relocated });
  writeFileSync(join(draftDir, "draft_content.json"), JSON.stringify(files.draftContent));
  writeFileSync(join(draftDir, "draft_meta_info.json"), JSON.stringify(files.draftMeta));

  let copiedToApp: string | null = null;
  const appRoot = jianyingUserDrafts();
  if (appRoot) {
    const dest = join(appRoot, folderName);
    mkdirSync(dest, { recursive: true });
    copyFileSync(join(draftDir, "draft_content.json"), join(dest, "draft_content.json"));
    copyFileSync(join(draftDir, "draft_meta_info.json"), join(dest, "draft_meta_info.json"));
    const destMat = join(dest, "materials");
    mkdirSync(destMat, { recursive: true });
    for (const m of relocated) {
      copyFileSync(m.path, join(destMat, basename(m.path)));
    }
    copiedToApp = dest;
  }

  return {
    draftDir,
    copiedToApp,
    hint: copiedToApp
      ? "已经拷进本机剪映/CapCut 草稿夹。打开剪映刷新草稿列表即可。"
      : "把这个文件夹整个拷到剪映草稿目录后再打开剪映。",
  };
}
