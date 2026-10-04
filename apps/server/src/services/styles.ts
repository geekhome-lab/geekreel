import { join } from "node:path";
import { dataDir } from "../config";
import { coverAbs, discoverStylePacks, getStylePack, mimeFromName, type LoadedPack } from "@vw/style";

export function extraPackDirs(): string[] {
  return [join(dataDir, "stylePacks")];
}

export function listPacks() {
  return discoverStylePacks(extraPackDirs()).map((p) => p.public);
}

export function loadPack(id: string): LoadedPack | null {
  return getStylePack(id, extraPackDirs());
}

export function packCover(id: string): { path: string; mime: string } | null {
  const pack = loadPack(id);
  if (!pack) return null;
  const path = coverAbs(pack);
  if (!path) return null;
  return { path, mime: mimeFromName(path) };
}
