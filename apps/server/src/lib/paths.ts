import { homedir } from "node:os";
import path from "node:path";

type Plat = NodeJS.Platform;

function nodePath(platform: Plat) {
  return platform === "win32" ? path.win32 : path.posix;
}

export function isAbsolutePath(p: string, platform: Plat = process.platform): boolean {
  return nodePath(platform).isAbsolute(p);
}

/** `/` 或 `C:\`：dirname 等于自身 */
export function isFsRootPath(p: string, platform: Plat = process.platform): boolean {
  const n = nodePath(platform);
  const r = n.normalize(p);
  return n.dirname(r) === r;
}

export function isInsideRoot(abs: string, root: string, platform: Plat = process.platform): boolean {
  const n = nodePath(platform);
  const a = n.normalize(abs);
  const r = n.normalize(root);
  if (platform === "win32") {
    const al = a.toLowerCase();
    const rl = r.toLowerCase();
    const prefix = rl.endsWith("\\") ? rl : `${rl}\\`;
    return al === rl || al.startsWith(prefix);
  }
  const prefix = r.endsWith("/") ? r : `${r}/`;
  return a === r || a.startsWith(prefix);
}

export function isForbiddenProjectDir(dir: string, home = homedir(), platform: Plat = process.platform): boolean {
  const n = nodePath(platform);
  const d = n.normalize(dir);
  const h = n.normalize(home);
  if (platform === "win32") {
    if (d.toLowerCase() === h.toLowerCase()) return true;
  } else if (d === h) {
    return true;
  }
  return n.dirname(d) === d;
}
