import type { CharacterDossier, DramaAssetItem, EntityKind, EntityView, EntityViewKind } from "@vw/core";
import { getAdapter } from "@vw/models";
import { matchLibraryEntity, mergeEntityViews, primaryEntityImage, viewPrompt, viewsForKind } from "@vw/pipeline";
import { findNamedEntityAssets, storeAsset, updateAssetMeta } from "./library";
import { resolveEndpoint } from "./models";
import { recordUsage } from "./usage";

export async function paintViews(opts: {
  projectId: string;
  kind: EntityKind;
  name: string;
  prompt: string;
  current?: EntityView[];
  imageAssetId?: string | null;
  imageEndpointId?: string | null;
  signal?: AbortSignal;
  skipIfDone?: boolean;
}): Promise<{ imageAssetId: string | null; views: EntityView[] }> {
  const wanted = viewsForKind(opts.kind);
  let existing = opts.current ?? [];
  const reused = matchLibraryEntity({
    name: opts.name,
    kind: opts.kind,
    assets: findNamedEntityAssets(opts.kind, opts.name),
  });
  if (reused) {
    for (const v of reused.views) existing = mergeEntityViews(existing, v);
  }
  if (opts.skipIfDone && wanted.every((k) => existing.some((v) => v.kind === k && v.assetId))) {
    return { imageAssetId: primaryEntityImage({ imageAssetId: opts.imageAssetId, views: existing }), views: existing };
  }
  const endpoint = resolveEndpoint("image", opts.imageEndpointId ?? undefined);
  const adapter = endpoint ? getAdapter(endpoint.adapterType) : null;
  if (!adapter?.generateImage || !endpoint) {
    return { imageAssetId: opts.imageAssetId ?? null, views: existing };
  }
  let views = [...existing];
  for (const kind of wanted) {
    if (views.some((v) => v.kind === kind && v.assetId)) continue;
    const still = await adapter.generateImage(endpoint.config, {
      prompt: viewPrompt({ kind: opts.kind, view: kind, name: opts.name, prompt: opts.prompt }),
      size: opts.kind === "character" ? "1024x1536" : "1024x1024",
      signal: opts.signal,
    });
    const asset = storeAsset({
      type: "image",
      title: `${opts.name}${kind === "full" ? "" : kind === "face" ? "脸" : kind === "side" ? "侧面" : "正面"}`,
      ext: "png",
      source: "pipeline",
      projectId: opts.projectId,
      data: still.data,
    });
    updateAssetMeta(asset.id, { kind: opts.kind, tags: [opts.name] });
    recordUsage({ endpoint, projectId: opts.projectId, jobType: "entity.views", images: 1 });
    views = mergeEntityViews(views, { kind, assetId: asset.id });
  }
  return { imageAssetId: primaryEntityImage({ imageAssetId: opts.imageAssetId, views }), views };
}

export async function paintCastViews(
  projectId: string,
  cast: CharacterDossier[],
  imageEndpointId?: string | null,
  signal?: AbortSignal,
): Promise<CharacterDossier[]> {
  const out = [...cast];
  for (let i = 0; i < Math.min(out.length, 8); i++) {
    const c = out[i]!;
    try {
      const painted = await paintViews({
        projectId,
        kind: "character",
        name: c.name,
        prompt: [c.appearance, c.outfit, c.prompt].filter(Boolean).join("，") || c.name,
        current: c.views,
        imageAssetId: c.imageAssetId,
        imageEndpointId,
        signal,
        skipIfDone: true,
      });
      out[i] = { ...c, imageAssetId: painted.imageAssetId, views: painted.views };
    } catch {
      /* 没图也能先看档案 */
    }
  }
  return out;
}

export async function paintExtraViews(
  projectId: string,
  extras: DramaAssetItem[],
  imageEndpointId?: string | null,
  signal?: AbortSignal,
): Promise<DramaAssetItem[]> {
  const out = [...extras];
  for (let i = 0; i < Math.min(out.length, 6); i++) {
    const a = out[i]!;
    try {
      const painted = await paintViews({
        projectId,
        kind: a.kind,
        name: a.name,
        prompt: a.prompt || a.name,
        current: a.views,
        imageAssetId: a.imageAssetId,
        imageEndpointId,
        signal,
        skipIfDone: true,
      });
      out[i] = { ...a, imageAssetId: painted.imageAssetId, views: painted.views };
    } catch {
      /* 场景道具没图也能先拆集 */
    }
  }
  return out;
}

export function viewKindLabel(kind: EntityViewKind): string {
  return kind === "face" ? "脸" : kind === "side" ? "侧面" : kind === "front" ? "正面" : "全景";
}
