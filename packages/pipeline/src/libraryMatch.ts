/**
 * 按名字把资产库里的定妆对上角色 / 场景 / 道具，跨集跨项目复用。
 */

import type { EntityKind, EntityView, EntityViewKind } from "@vw/core";

export function inferViewKind(title: string, kind: EntityKind): EntityViewKind {
  if (kind !== "character") return "full";
  if (title.includes("侧面")) return "side";
  if (title.includes("脸") || title.includes("面部")) return "face";
  if (title.includes("正面") || title.includes("全身")) return "front";
  return "front";
}

export function matchLibraryEntity(opts: {
  name: string;
  kind: EntityKind;
  assets: Array<{ id: string; title: string; kind?: string; tags?: string[] }>;
}): { imageAssetId: string; views: EntityView[] } | null {
  const name = opts.name.trim();
  if (!name) return null;
  const hits = opts.assets.filter((a) => {
    if (opts.kind && a.kind && a.kind !== "generic" && a.kind !== opts.kind) return false;
    return a.title.includes(name) || (a.tags ?? []).includes(name);
  });
  if (!hits.length) return null;
  const views: EntityView[] = [];
  for (const a of hits) {
    const kind = inferViewKind(a.title, opts.kind);
    if (!views.some((v) => v.kind === kind)) views.push({ kind, assetId: a.id });
  }
  return { imageAssetId: views[0]!.assetId, views };
}
