/**
 * 竞品分析 + 复刻模板（前后端共享类型）。
 */

export interface AnalysisShot {
  startMs: number;
  endMs: number;
  visual: string;
  line: string;
}

export interface AnalysisSection {
  name: string;
  startMs: number;
  endMs: number;
  note: string;
}

export interface RemakeSlot {
  id: string;
  maxSec: number;
  shotDesc: string;
  lineSlot: string;
}

export interface RemakeTemplateDoc {
  name: string;
  variables: string[];
  slots: RemakeSlot[];
}

export interface AnalysisReportDoc {
  title: string;
  hook: { startMs: number; endMs: number; summary: string };
  structure: AnalysisSection[];
  shots: AnalysisShot[];
  rhythm: { shotCount: number; avgShotMs: number; wordsPerSec: number | null; note: string };
  viralFactors: string[];
  template: RemakeTemplateDoc;
}

export interface AnalysisFrame {
  tMs: number;
  file: string;
}

export interface AnalysisReport {
  id: string;
  sourceUrl: string | null;
  videoAssetId: string | null;
  title: string;
  report: AnalysisReportDoc;
  frames: AnalysisFrame[];
  transcript: string | null;
  createdAt: number;
}

export interface RemakeTemplate {
  id: string;
  analysisId: string | null;
  name: string;
  doc: RemakeTemplateDoc;
  createdAt: number;
}

export interface RemakeRun {
  id: string;
  templateId: string;
  projectId: string | null;
  variables: Record<string, string>;
  status: string;
  createdAt: number;
}
