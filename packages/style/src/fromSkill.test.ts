import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverStylePacks } from "./index";
import { heuristicDraft, parseSkillMarkdown, parseStyleDraft, skillFetchCandidates } from "./fromSkill";
import { importPackFromZip, writeStylePack } from "./writePack";
import { zipDirectory } from "./zip";

test("parseSkillMarkdown 读 frontmatter", () => {
  const doc = parseSkillMarkdown(`---
name: shop-video
description: >
  电商带货口播分镜。
---
# 视觉
主色红金，商品特写。
`);
  expect(doc.name).toBe("shop-video");
  expect(doc.description).toContain("电商带货");
  expect(doc.body).toContain("商品特写");
});

test("GitHub 目录链接展开成 raw 候选", () => {
  const urls = skillFetchCandidates("https://github.com/acme/skills/tree/main/shop-video");
  expect(urls.some((u) => u.includes("raw.githubusercontent.com") && u.endsWith("SKILL.md"))).toBe(true);
});

test("heuristic + 写入后能被扫描到", () => {
  const dir = mkdtempSync(join(tmpdir(), "vw-style-"));
  const draft = heuristicDraft(
    { name: "shop", description: "带货", body: "红金主色，商品大特写。" },
    "电商带货",
  );
  const written = writeStylePack({ draft, destRoot: dir, extraDirs: [dir] });
  const found = discoverStylePacks([dir]).find((p) => p.public.id === written.id);
  expect(found?.public.name).toBe("电商带货");
  expect(found?.public.editable).toBe(true);
  expect(found?.public.stylePrompt).toContain("红金");
  expect(found?.styleBlock).toContain("红金");
  rmSync(dir, { recursive: true, force: true });
});

test("风格包 zip 导出再导入能还原", () => {
  const dir = mkdtempSync(join(tmpdir(), "vw-style-"));
  const dest = mkdtempSync(join(tmpdir(), "vw-style-in-"));
  const draft = heuristicDraft(
    { name: "clay", description: "黏土", body: "黏土颗粒，暖光。" },
    "黏土定格",
  );
  const written = writeStylePack({ draft, destRoot: dir, extraDirs: [dir] });
  const zip = zipDirectory(written.directory, written.id);
  const imported = importPackFromZip(zip, [dest], dest);
  expect(imported?.name).toBe("黏土定格");
  const found = discoverStylePacks([dest]).find((p) => p.public.id === imported?.id);
  expect(found?.styleBlock).toContain("黏土");
  rmSync(dir, { recursive: true, force: true });
  rmSync(dest, { recursive: true, force: true });
});

test("parseStyleDraft 抠 JSON", () => {
  const d = parseStyleDraft('{"name":"黏土","summary":"黏土定格","styleBlock":"黏土颗粒","hardConstraint":"不要3D"}', "黏土");
  expect(d.name).toBe("黏土");
  expect(d.styleBlock).toContain("黏土");
});
