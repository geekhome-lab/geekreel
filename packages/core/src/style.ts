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

export interface DramaAssetItem {
  id: string;
  kind: "character" | "scene" | "prop";
  name: string;
  prompt: string;
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
