import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

function namesFor(bin: string): string[] {
  if (process.platform !== "win32") return [bin];
  if (/\.(exe|cmd|bat)$/i.test(bin)) return [bin];
  return [bin, `${bin}.exe`, `${bin}.cmd`, `${bin}.bat`];
}

function firstExistingLine(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/)) {
    const p = line.trim().replace(/^"|"$/g, "");
    if (p && existsSync(p)) return p;
  }
  return null;
}

/** 在 PATH 里找可执行文件。Windows 用 where.exe，不依赖 /usr/bin/which。 */
export function whichBin(name: string): string | null {
  const names = namesFor(name);
  if (process.platform === "win32") {
    for (const n of names) {
      try {
        const proc = Bun.spawnSync(["where.exe", n], { stdout: "pipe", stderr: "ignore" });
        if (proc.exitCode === 0) {
          const hit = firstExistingLine(proc.stdout.toString());
          if (hit) return hit;
        }
      } catch {
        /* 继续扫 PATH */
      }
    }
  } else {
    try {
      const proc = Bun.spawnSync(["which", name], { stdout: "pipe", stderr: "ignore" });
      if (proc.exitCode === 0) {
        const hit = firstExistingLine(proc.stdout.toString());
        if (hit) return hit;
      }
    } catch {
      /* 继续扫 PATH */
    }
  }

  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    for (const n of names) {
      const p = join(dir, n);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

export function exeName(bin: string): string {
  if (process.platform !== "win32") return bin;
  if (/\.(exe|cmd|bat)$/i.test(bin)) return bin;
  return `${bin}.exe`;
}
