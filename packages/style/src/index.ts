/**
 * @vw/style —— 风格包文件制加载。加包 = 往 stylePacks/ 丢目录，不用改主代码。
 * 内置包打进仓库，换机器也能用。
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { PaletteDoc, StylePackManifest, StylePackPublic } from "@vw/core";

export * from "./fromSkill";
export * from "./writePack";
export * from "./zip";

export interface LoadedPack {
  public: StylePackPublic;
  manifest: StylePackManifest;
  directory: string;
  styleBlock: string;
  hardConstraint: string;
  negative: string;
  bibleSystem: string | null;
  substyleBlocks: Record<string, string>;
}

export function repoStylePacksDir(): string {
  return resolve(join(import.meta.dir, "../../../stylePacks"));
}

const BUILTIN_IDS = new Set(["smy-animation", "whiteboard"]);

function readText(dir: string, rel?: string): string {
  if (!rel) return "";
  const abs = join(dir, rel);
  if (!existsSync(abs)) return "";
  return readFileSync(abs, "utf8").trim();
}

function loadOne(directory: string): LoadedPack | null {
  const manifestPath = join(directory, "pack.json");
  if (!existsSync(manifestPath)) return null;
  let manifest: StylePackManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as StylePackManifest;
  } catch {
    return null;
  }
  if (!manifest.id?.trim() || !manifest.name?.trim()) return null;

  const files = manifest.promptFiles ?? {};
  const substyleBlocks: Record<string, string> = {};
  const subDir = join(directory, "prompts", "substyles");
  if (existsSync(subDir) && statSync(subDir).isDirectory()) {
    for (const name of readdirSync(subDir)) {
      if (!name.endsWith(".md")) continue;
      substyleBlocks[name.replace(/\.md$/, "")] = readFileSync(join(subDir, name), "utf8").trim();
    }
  }

  const ready = manifest.ready !== false;
  const source: "builtin" | "user" =
    manifest.source === "user" || (manifest.source !== "builtin" && !BUILTIN_IDS.has(manifest.id))
      ? "user"
      : "builtin";
  return {
    directory,
    manifest,
    styleBlock: readText(directory, files.style ?? "prompts/style-block.md"),
    hardConstraint: readText(directory, files.hard ?? "prompts/hard-constraint.md"),
    negative: readText(directory, files.negative ?? "prompts/negative.md"),
    bibleSystem: readText(directory, files.bible ?? "prompts/bible-system.md") || null,
    substyleBlocks,
    public: {
      id: manifest.id.trim(),
      name: manifest.name.trim(),
      version: String(manifest.version ?? "0.1.0"),
      summary: String(manifest.summary ?? "").trim(),
      coverUrl: manifest.cover && existsSync(join(directory, manifest.cover))
        ? `/api/styles/${manifest.id}/cover`
        : null,
      previewColors: Array.isArray(manifest.previewColors) ? manifest.previewColors.map(String) : [],
      requiredCapabilities: manifest.requiredCapabilities ?? ["llm", "image"],
      substyles: manifest.substyles ?? [],
      defaultSubstyle: manifest.defaultSubstyle ?? manifest.substyles?.[0]?.id ?? null,
      ready,
      unavailableReason: ready ? null : (manifest.unavailableReason?.trim() || "这套风格还没开放"),
      directory,
      source,
      originUrl: manifest.originUrl?.trim() || null,
      editable: source === "user",
    },
  };
}

function scanDir(root: string, out: Map<string, LoadedPack>): void {
  if (!existsSync(root) || !statSync(root).isDirectory()) return;
  for (const name of readdirSync(root)) {
    if (name.startsWith(".")) continue;
    const dir = join(root, name);
    if (!statSync(dir).isDirectory()) continue;
    const pack = loadOne(dir);
    if (!pack) continue;
    if (!out.has(pack.public.id)) out.set(pack.public.id, pack);
  }
}

export function discoverStylePacks(extraDirs: string[] = []): LoadedPack[] {
  const map = new Map<string, LoadedPack>();
  scanDir(repoStylePacksDir(), map);
  for (const extra of extraDirs) {
    if (extra.trim()) scanDir(resolve(extra.trim()), map);
  }
  const env = process.env.VW_STYLE_PACKS;
  if (env) {
    for (const p of env.split(":")) scanDir(p, map);
  }
  return [...map.values()].sort((a, b) => {
    if (a.public.ready !== b.public.ready) return a.public.ready ? -1 : 1;
    return a.public.name.localeCompare(b.public.name, "zh");
  });
}

export function getStylePack(id: string, extraDirs: string[] = []): LoadedPack | null {
  return discoverStylePacks(extraDirs).find((p) => p.public.id === id) ?? null;
}

export function paletteLine(palette: PaletteDoc): string {
  if (!palette.colors.length) return "";
  const parts = palette.colors.map((c) => `${c.name}${c.hex ? `(${c.hex})` : ""}作${c.role || "色"}`);
  return `剧组色盘（必须逐色用上，禁止另起一套）：${parts.join("、")}。`;
}

/** 引擎强制注入：风格块 + 子风格 + 色盘 + 原文 + 硬约束 + 负面 */
export function injectImagePrompt(opts: {
  pack: LoadedPack;
  raw: string;
  palette?: PaletteDoc | null;
  substyle?: string | null;
  lastFrame?: string | null;
}): string {
  const sub = opts.substyle ? opts.pack.substyleBlocks[opts.substyle] : "";
  const chunks = [
    opts.pack.styleBlock,
    sub,
    opts.palette ? paletteLine(opts.palette) : "",
    opts.lastFrame ? `紧接上一镜尾帧：${opts.lastFrame}` : "",
    opts.raw.trim(),
    opts.pack.hardConstraint,
    opts.pack.negative ? `不要出现：${opts.pack.negative}` : "",
  ];
  return chunks.map((s) => (s ?? "").trim()).filter(Boolean).join("\n");
}

export function coverAbs(pack: LoadedPack): string | null {
  const rel = pack.manifest.cover;
  if (!rel) return null;
  const abs = join(pack.directory, rel);
  return existsSync(abs) ? abs : null;
}

export function mimeFromName(name: string): string {
  if (name.endsWith(".svg")) return "image/svg+xml";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}
