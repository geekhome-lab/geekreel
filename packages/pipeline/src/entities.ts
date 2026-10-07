/**
 * 角色 / 场景 / 道具实体：多视图、每镜强制引用、跨集沿用。
 */

import type {
  CharacterDossier,
  DramaAssetItem,
  DramaBible,
  EntityKind,
  EntityView,
  EntityViewKind,
} from "@vw/core";
import { lockCastIntoPrompt } from "./lock";

export const VIEW_LABEL: Record<EntityViewKind, string> = {
  face: "脸",
  front: "正面",
  side: "侧面",
  full: "全景",
};

export function viewsForKind(kind: EntityKind): EntityViewKind[] {
  return kind === "character" ? ["face", "front", "side"] : ["full"];
}

export function viewPrompt(opts: {
  kind: EntityKind;
  view: EntityViewKind;
  name: string;
  prompt: string;
}): string {
  const look = opts.prompt.trim() || opts.name;
  if (opts.kind === "scene") {
    return `场景空镜，没有人物，固定机位。${look}。禁止出现人脸和字幕。`;
  }
  if (opts.kind === "prop") {
    return `道具设定图，干净背景，无文字。${look}`;
  }
  if (opts.view === "face") {
    return `角色定妆面部特写，正对镜头，肩部以上，白底，无文字。必须是「${opts.name}」：${look}。同一张脸，禁止换脸。`;
  }
  if (opts.view === "side") {
    return `角色定妆全身左侧站姿，白底，无文字。必须是「${opts.name}」同一张脸、同一套衣服：${look}`;
  }
  return `角色定妆全身正面站姿，白底，无文字。必须是「${opts.name}」同一张脸、同一套衣服：${look}`;
}

export function primaryEntityImage(e: { imageAssetId?: string | null; views?: EntityView[] }): string | null {
  return (
    e.views?.find((v) => v.kind === "face")?.assetId ??
    e.views?.find((v) => v.kind === "front")?.assetId ??
    e.imageAssetId ??
    e.views?.[0]?.assetId ??
    null
  );
}

export function allEntityImageIds(e: { imageAssetId?: string | null; views?: EntityView[] }): string[] {
  const ids = [...(e.views ?? []).map((v) => v.assetId), e.imageAssetId ?? ""].filter(Boolean);
  return [...new Set(ids)];
}

export function mergeEntityViews(current: EntityView[] | undefined, next: EntityView): EntityView[] {
  const rest = (current ?? []).filter((v) => v.kind !== next.kind);
  return [...rest, next];
}

type NamedEntity = { id: string; name: string; kind: EntityKind };

function catalog(bible: Pick<DramaBible, "cast" | "assets">): NamedEntity[] {
  const seen = new Set<string>();
  const out: NamedEntity[] = [];
  for (const c of bible.cast ?? []) {
    if (!c.id || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push({ id: c.id, name: c.name, kind: "character" });
  }
  for (const a of bible.assets ?? []) {
    if (!a.id || seen.has(a.id)) continue;
    seen.add(a.id);
    out.push({ id: a.id, name: a.name, kind: a.kind });
  }
  return out;
}

/** 点到谁就锁谁；没点名也把主要角色和场景带上，每镜必须有引用。 */
export function bindEntitiesToShots(bible: DramaBible): DramaBible {
  const names = catalog(bible);
  const fallback = names.slice(0, 4).map((n) => n.id);
  return {
    ...bible,
    episodes: bible.episodes.map((ep) => ({
      ...ep,
      shots: ep.shots.map((shot) => {
        if (shot.entityIds?.length) return shot;
        const hay = `${shot.visual}\n${shot.line}\n${shot.imagePrompt}`;
        const hit = names.filter((n) => n.name && hay.includes(n.name)).map((n) => n.id);
        return { ...shot, entityIds: hit.length ? [...new Set(hit)] : fallback };
      }),
    })),
  };
}

export function entitiesForShot(
  bible: Pick<DramaBible, "cast" | "assets">,
  entityIds?: string[],
): Array<CharacterDossier | DramaAssetItem> {
  const byId = new Map<string, CharacterDossier | DramaAssetItem>();
  for (const c of bible.cast ?? []) byId.set(c.id, c);
  for (const a of bible.assets ?? []) if (!byId.has(a.id)) byId.set(a.id, a);
  const ids = entityIds?.length ? entityIds : [...byId.keys()].slice(0, 4);
  return ids.map((id) => byId.get(id)).filter((x): x is CharacterDossier | DramaAssetItem => Boolean(x));
}

export function pickShotRefImages(
  bible: Pick<DramaBible, "cast" | "assets">,
  entityIds?: string[],
  extra?: string[],
): string[] {
  const used = entitiesForShot(bible, entityIds);
  const ids: string[] = [];
  for (const e of used) ids.push(...allEntityImageIds(e));
  for (const id of extra ?? []) if (id) ids.push(id);
  return [...new Set(ids)].slice(0, 6);
}

export function lockProductionIntoPrompt(opts: {
  prompt: string;
  bible: Pick<DramaBible, "cast" | "assets">;
  entityIds?: string[];
  lastFrame?: string | null;
  dialogue?: string | null;
}): string {
  const used = entitiesForShot(opts.bible, opts.entityIds);
  const cast = used.filter((e): e is CharacterDossier => "appearance" in e);
  const extras = used.filter((e) => !("appearance" in e)) as DramaAssetItem[];
  const base = lockCastIntoPrompt({
    prompt: opts.prompt,
    cast: cast.length ? cast : (opts.bible.cast ?? []),
    lastFrame: opts.lastFrame,
    dialogue: opts.dialogue,
  });
  const more = extras
    .map((e) => {
      if (e.kind === "scene") return `场景锁定「${e.name}」：${e.prompt}。必须是同一处空间，禁止换地方。`;
      return `道具锁定「${e.name}」：${e.prompt}。外形材质不要改。`;
    })
    .join("\n");
  return [more, base].filter(Boolean).join("\n");
}

export function assetsFromEntities(cast: CharacterDossier[], extras: DramaAssetItem[] = []): DramaAssetItem[] {
  const fromCast: DramaAssetItem[] = cast.map((c) => ({
    id: c.id,
    kind: "character",
    name: c.name,
    prompt: c.prompt,
    imageAssetId: primaryEntityImage(c),
    views: c.views,
  }));
  const seen = new Set(fromCast.map((a) => a.id));
  const rest = extras.filter((a) => a.id && !seen.has(a.id)).map((a) => ({
    ...a,
    imageAssetId: primaryEntityImage(a),
  }));
  return [...fromCast, ...rest];
}
