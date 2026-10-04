import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { sanitizeTitle, type StylePackManifest } from "@vw/core";
import type { StyleDraft } from "./fromSkill";

export function userStylePacksRoot(): string {
  return resolve(join(import.meta.dir, "../../../stylePacks"));
}

export function slugStyleId(name: string): string {
  const ascii = name
    .normalize("NFKD")
    .replace(/[^\w\u4e00-\u9fff]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  const short = sanitizeTitle(ascii || name, 24).replace(/\s+/g, "-").toLowerCase();
  return short || "style";
}

function takenIds(extraDirs: string[] = []): Set<string> {
  const taken = new Set(["smy-animation", "whiteboard"]);
  for (const root of [userStylePacksRoot(), ...extraDirs]) {
    if (!existsSync(root)) continue;
    let names: string[] = [];
    try {
      names = readdirSync(root);
    } catch {
      continue;
    }
    for (const name of names) {
      const dir = join(root, name);
      try {
        if (!statSync(dir).isDirectory()) continue;
        const mf = join(dir, "pack.json");
        if (!existsSync(mf)) continue;
        const id = (JSON.parse(readFileSync(mf, "utf8")) as { id?: string }).id;
        taken.add(id || name);
      } catch {
        taken.add(name);
      }
    }
  }
  return taken;
}

export function uniqueStyleId(name: string, extraDirs: string[] = []): string {
  const base = slugStyleId(name);
  const taken = takenIds(extraDirs);
  if (!taken.has(base)) return base;
  for (let i = 2; i < 50; i++) {
    const id = `${base}-${i}`;
    if (!taken.has(id)) return id;
  }
  return `${base}-${Date.now().toString(36).slice(-4)}`;
}

export function writeStylePack(opts: {
  draft: StyleDraft;
  originUrl?: string | null;
  extraDirs?: string[];
  destRoot?: string;
}): { id: string; directory: string } {
  const id = uniqueStyleId(opts.draft.name, opts.extraDirs);
  const root = opts.destRoot ?? userStylePacksRoot();
  const directory = join(root, id);
  mkdirSync(join(directory, "prompts", "substyles"), { recursive: true });

  const manifest: StylePackManifest = {
    id,
    name: opts.draft.name,
    version: "1.0.0",
    summary: opts.draft.summary,
    previewColors: opts.draft.previewColors,
    requiredCapabilities: opts.draft.requiredCapabilities,
    substyles: opts.draft.substyles,
    defaultSubstyle: opts.draft.substyles[0]?.id,
    ready: true,
    source: "user",
    originUrl: opts.originUrl ?? undefined,
  };
  writeFileSync(join(directory, "pack.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(join(directory, "prompts", "style-block.md"), `${opts.draft.styleBlock}\n`);
  writeFileSync(join(directory, "prompts", "hard-constraint.md"), `${opts.draft.hardConstraint}\n`);
  writeFileSync(join(directory, "prompts", "negative.md"), `${opts.draft.negative}\n`);
  writeFileSync(join(directory, "prompts", "bible-system.md"), `${opts.draft.bibleSystem}\n`);
  for (const sub of opts.draft.substyles) {
    writeFileSync(join(directory, "prompts", "substyles", `${sub.id}.md`), `${sub.name}：${sub.hint}\n`);
  }
  writeFileSync(
    join(directory, "pipeline.json"),
    JSON.stringify({ id: `${id}-drama`, name: `${opts.draft.name}短剧`, steps: ["bible", "inject", "canvas"] }, null, 2),
  );
  return { id, directory };
}

export function removeUserPackDir(directory: string): void {
  rmSync(directory, { recursive: true, force: true });
}
