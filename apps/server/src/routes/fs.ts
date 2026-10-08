import { Hono } from "hono";
import { readdirSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isFsRootPath } from "../lib/paths";
import { err, ok } from "../lib/resp";

/**
 * 本机目录浏览：供「选择文件夹」UI 使用（浏览器无法直接选服务器侧目录）。
 * 只列目录，默认隐藏点开头文件。
 */
export const fsRoutes = new Hono();

const WIN_DRIVES = "\\";

function isWinDriveList(raw: string | undefined): boolean {
  return process.platform === "win32" && !!raw && /^[\\/]+$/.test(raw);
}

function listWindowsDrives(): Array<{ name: string; path: string }> {
  const out: Array<{ name: string; path: string }> = [];
  for (let i = 65; i <= 90; i++) {
    const letter = String.fromCharCode(i);
    const p = `${letter}:\\`;
    if (existsSync(p)) out.push({ name: `${letter}:`, path: p });
  }
  return out;
}

fsRoutes.get("/browse", (c) => {
  const raw = c.req.query("path")?.trim();
  if (isWinDriveList(raw)) {
    return ok(c, {
      path: WIN_DRIVES,
      parent: WIN_DRIVES,
      isRoot: true,
      dirs: listWindowsDrives(),
    });
  }

  const target = resolve(raw || homedir());
  if (!existsSync(target)) return err(c, "目录不存在", 404);

  let entries: Array<{ name: string; path: string }>;
  try {
    entries = readdirSync(target, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => ({ name: e.name, path: join(target, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  } catch {
    return err(c, "无法读取该目录（权限不足）");
  }

  const atVolumeRoot = isFsRootPath(target);
  return ok(c, {
    path: target,
    parent: atVolumeRoot && process.platform === "win32" ? WIN_DRIVES : dirname(target),
    isRoot: atVolumeRoot && process.platform !== "win32",
    dirs: entries,
  });
});

fsRoutes.post("/mkdir", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { path?: string; name?: string };
  if (!body.path || !body.name?.trim()) return err(c, "缺少参数");
  const name = body.name.trim();
  if (/[/\\]/.test(name) || name.startsWith(".")) return err(c, "文件夹名不合法");
  if (isWinDriveList(body.path)) return err(c, "请先进入某个磁盘再新建文件夹");
  const target = join(resolve(body.path), name);
  if (existsSync(target)) return err(c, "已存在同名文件或文件夹");
  try {
    mkdirSync(target, { recursive: false });
  } catch {
    return err(c, "创建失败（权限不足？）");
  }
  return ok(c, { path: target });
});
