/**
 * 风格包与短剧圣经（前后端共享）。
 */

export type StyleCapability = "llm" | "image" | "video" | "tts";

export interface StyleSubstyle {
  id: string;
  name: string;
  hint: string;
}

export interface StylePackManifest {
  id: string;
  name: string;
  version: string;
  summary: string;
  cover?: string;
  previewColors?: string[];
  requiredCapabilities: StyleCapability[];
  substyles?: StyleSubstyle[];
  defaultSubstyle?: string;
  ready?: boolean;
  unavailableReason?: string;
  /** builtin 不能删；user 是添加进来的 */
  source?: "builtin" | "user";
  originUrl?: string;
  promptFiles?: {
    style?: string;
    hard?: string;
    negative?: string;
    bible?: string;
  };
}

export interface StylePackPublic {
  id: string;
  name: string;
  version: string;
  summary: string;
  coverUrl: string | null;
  previewColors: string[];
  requiredCapabilities: StyleCapability[];
  substyles: StyleSubstyle[];
  defaultSubstyle: string | null;
  ready: boolean;
  unavailableReason: string | null;
  directory: string;
  source: "builtin" | "user";
  originUrl: string | null;
  /** 出图/出片时整段注入，避免只写风格名 */
  stylePrompt: string;
  editable: boolean;
}

export interface PaletteColor {
  name: string;
  hex: string;
  role: string;
}

export interface PaletteDoc {
  colors: PaletteColor[];
  note: string;
}

export type EntityKind = "character" | "scene" | "prop";
export type EntityViewKind = "face" | "front" | "side" | "full";

export interface EntityView {
  kind: EntityViewKind;
  assetId: string;
}

export interface DramaAssetItem {
  id: string;
  kind: EntityKind;
  name: string;
  prompt: string;
  imageAssetId?: string | null;
  views?: EntityView[];
}

/** 通读全文后的角色档案，不是点选风格包 */
export interface CharacterDossier {
  id: string;
  name: string;
  identity: string;
  personality: string;
  appearance: string;
  outfit: string;
  prompt: string;
  imageAssetId?: string | null;
  views?: EntityView[];
}

export interface StoryEvent {
  id: string;
  chapter: string;
  index: number;
  title: string;
  summary: string;
  characters: string[];
}

export interface DramaShot {
  startSec: number;
  endSec: number;
  visual: string;
  line: string;
  imagePrompt: string;
  imageAssetId?: string | null;
  videoAssetId?: string | null;
  audioAssetId?: string | null;
  /** 这一镜必须引用的角色 / 场景 / 道具 id */
  entityIds?: string[];
  /** 对口型那道过了才是 true。失败时仍保留原视频，不改成静帧。 */
  lipSynced?: boolean;
  lipsNote?: string | null;
}

export interface DramaEpisode {
  index: number;
  title: string;
  synopsis: string;
  narrator: string;
  shots: DramaShot[];
  lastFrame: string;
}

export interface DramaBible {
  title: string;
  packId: string | null;
  substyle: string | null;
  palette: PaletteDoc;
  assets: DramaAssetItem[];
  episodes: DramaEpisode[];
  cast?: CharacterDossier[];
  events?: StoryEvent[];
  /** 整部沿用的配乐，出集时铺到时间线 */
  bgmAssetId?: string | null;
}

export interface PipelineRun {
  id: string;
  projectId: string;
  templateId: string;
  packId: string | null;
  status: string;
  currentStep: string;
  bible: DramaBible | null;
  createdAt: number;
  updatedAt: number;
}

/** 自由创作 / 无链接复刻：先列分镜，用户确认后再搭画布 */
export interface FreeShot {
  id: string;
  visual: string;
  line: string;
  imagePrompt: string;
}

export interface FreePlan {
  title: string;
  summary: string;
  shots: FreeShot[];
}

/** 首页：先出剧本，再对台词批注 */
export interface ScriptLine {
  id: string;
  speaker: string;
  text: string;
}

export interface ScriptScene {
  id: string;
  heading: string;
  action: string;
  lines: ScriptLine[];
  startSec: number;
  endSec: number;
}

export interface ScriptNote {
  id: string;
  targetId: string;
  text: string;
}

export interface ScriptDoc {
  title: string;
  logline: string;
  durationSec: number;
  scenes: ScriptScene[];
}

export interface KeyAssetNeed {
  id: string;
  kind: EntityKind;
  name: string;
  prompt: string;
  assetId?: string | null;
  views?: EntityView[];
}

/** 一场戏里要说出口的台词。讲解片没写对白时，用场次名当旁白。 */
export function spokenLine(
  scene: Pick<ScriptScene, "lines"> | { lines?: Array<{ text?: string }>; heading?: string },
): string {
  const fromLines = (scene.lines ?? [])
    .map((l) => String(l.text ?? "").trim())
    .filter(Boolean)
    .join("\n");
  if (fromLines) return fromLines;
  const heading = "heading" in scene ? String(scene.heading ?? "").trim() : "";
  return heading.replace(/^[^·]+·/, "").trim();
}

/** 从画布提示词里抽出「角色：台词」 */
export function extractDialogue(text: string): string {
  const spoken: string[] = [];
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(.{1,16})[：:](.+)$/.exec(line);
    if (!m) continue;
    const speaker = m[1]!.trim();
    const body = m[2]!.trim();
    if (!body) continue;
    if (/^【/.test(speaker)) continue;
    if (/风格|锁定|必须|参考|画面|时长/.test(speaker)) continue;
    if (/\d+:\d+/.test(speaker)) continue;
    spoken.push(body);
  }
  return spoken.join("\n");
}
