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
