import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { AnalysisFrame, AnalysisReport, AnalysisReportDoc } from "@vw/core";
import {
  analysisPrompt,
  ANALYZE_SYSTEM,
  detectYtdlp,
  downloadWithYtdlp,
  ensureYtdlp,
  fallbackTemplate,
  parseAnalysisReport,
  sampleFrames,
} from "@vw/analyze";
import { detectBins, extractAudio, probe } from "@vw/media";
import { getAdapter } from "@vw/models";
import { dataDir } from "../config";
import { db } from "../db";
import type { JobHandler } from "../jobs/queue";
import { newId, now } from "../lib/resp";
import { absInLibrary, storeAsset } from "./library";
import { getEndpoint, listEndpoints, resolveEndpoint } from "./models";
import { chatMetered, recordUsage } from "./usage";

interface ReportRow {
  id: string;
  sourceUrl: string | null;
  videoAssetId: string | null;
  title: string;
  reportJson: string;
  framesJson: string;
  transcript: string | null;
  createdAt: number;
}

function rowToReport(row: ReportRow): AnalysisReport {
  return {
    id: row.id,
    sourceUrl: row.sourceUrl,
    videoAssetId: row.videoAssetId,
    title: row.title,
    report: JSON.parse(row.reportJson) as AnalysisReportDoc,
    frames: JSON.parse(row.framesJson || "[]") as AnalysisFrame[],
    transcript: row.transcript,
    createdAt: row.createdAt,
  };
}

export function listReports(): AnalysisReport[] {
  return (db.query("SELECT * FROM analysis_reports ORDER BY createdAt DESC LIMIT 50").all() as ReportRow[]).map(rowToReport);
}

export function getReport(id: string): AnalysisReport | null {
  const row = db.query("SELECT * FROM analysis_reports WHERE id = ?").get(id) as ReportRow | null;
  return row ? rowToReport(row) : null;
}

export function frameAbs(reportId: string, file: string): string {
  const safe = file.replace(/[^a-zA-Z0-9._-]/g, "");
  return join(dataDir, "analyze", reportId, safe);
}

export function analyzeStatus() {
  const ytdlp = detectYtdlp();
  return {
    ytdlp: !!ytdlp.bin,
    hasLlm: listEndpoints("llm").some((e) => e.enabled),
  };
}

export const analyzeRunHandler: JobHandler = async (job, ctx) => {
  const payload = JSON.parse(job.payloadJson) as { url?: string; assetId?: string; endpointId?: string };
  const id = newId();
  const workDir = join(dataDir, "analyze", id);
  mkdirSync(workDir, { recursive: true });

  ctx.progress(0.05, "准备素材");
  let sourceUrl = payload.url?.trim() || null;
  let title = "竞品视频";
  let videoAbs = "";
  let videoAssetId: string | null = payload.assetId ?? null;

  if (payload.assetId) {
    const row = db.query("SELECT * FROM assets WHERE id = ?").get(payload.assetId) as { path: string; title: string; type: string } | null;
    if (!row || row.type !== "video") throw new Error("请选一条视频资产");
    videoAbs = absInLibrary(row.path);
    title = row.title;
  } else if (sourceUrl) {
    ctx.progress(0.1, "下载视频");
    const bins = await detectBins();
    let ytdlp = detectYtdlp();
    if (!ytdlp.bin) {
      ctx.progress(0.12, "准备下载器");
      ytdlp = await ensureYtdlp(dataDir);
    }
    if (!ytdlp.bin) throw new Error("没有 yt-dlp。把视频导入「资产库」再分析，或设置 VW_YTDLP。");
    const dl = await downloadWithYtdlp({
      bin: ytdlp.bin,
      url: sourceUrl,
      outDir: join(workDir, "dl"),
      ffmpegBin: bins.ffmpeg,
    });
    title = dl.title.replace(/\s+/g, " ").slice(0, 40) || title;
    const ext = dl.file.split(".").pop()?.toLowerCase() || "mp4";
    const asset = storeAsset({
      type: "video",
      title,
      ext: ext === "webm" || ext === "mkv" || ext === "mov" ? ext : "mp4",
      source: "analyze",
      fromPath: dl.file,
    });
    videoAssetId = asset.id;
    videoAbs = absInLibrary(asset.path);
  } else {
    throw new Error("请粘贴视频链接，或从资产库选一条视频");
  }

  if (!existsSync(videoAbs)) throw new Error("视频文件不存在");

  ctx.progress(0.35, "看时长和画面");
  const bins = await detectBins();
  if (!bins.ffmpeg || !bins.ffprobe) throw new Error("ffmpeg 不可用");
  const info = await probe(bins.ffprobe, videoAbs);
  const durationMs = info?.durationMs ?? 8000;

  const frames = await sampleFrames({
    ffmpeg: bins.ffmpeg,
    input: videoAbs,
    outDir: workDir,
    durationMs,
    signal: ctx.signal,
  });

  ctx.progress(0.55, "试着转写旁白");
  let transcript: string | null = null;
  try {
    const audioPath = join(workDir, "audio.wav");
    await extractAudio(bins.ffmpeg, videoAbs, audioPath, { maxSec: 180, signal: ctx.signal });
    if (existsSync(audioPath)) {
      const speechEp =
        resolveEndpoint("tts") ??
        listEndpoints().map((e) => getEndpoint(e.id, true)).find((e) => e && getAdapter(e.adapterType)?.transcribe) ??
        null;
      const tr = speechEp ? getAdapter(speechEp.adapterType)?.transcribe : null;
      if (speechEp && tr) {
        const wav = new Uint8Array(readFileSync(audioPath));
        transcript = (await tr(speechEp.config, { data: wav, filename: "audio.wav", mime: "audio/wav", signal: ctx.signal })) || null;
        if (transcript) {
          recordUsage({ endpoint: speechEp, jobType: "analyze.transcribe", audioChars: transcript.length });
        }
      }
    }
  } catch {
    transcript = null;
  }

  ctx.progress(0.7, "请文本模型拆解");
  const endpoint = resolveEndpoint("llm", payload.endpointId);
  if (!endpoint) throw new Error("还没有文本模型。分析要靠它读结构和节奏，请到「模型」页添加一个。");
  const adapter = getAdapter(endpoint.adapterType);
  if (!adapter?.chat) throw new Error("这个模型不会聊天，换一个文本模型");

  let doc: AnalysisReportDoc;
  try {
    const text = await chatMetered(
      adapter,
      endpoint,
      {
        system: ANALYZE_SYSTEM,
        prompt: analysisPrompt({ title, durationMs, frames, transcript, sourceUrl }),
      },
      { jobType: "analyze.run" },
    );
    doc = parseAnalysisReport(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("JSON") || msg.includes("解析")) {
      doc = {
        title,
        hook: { startMs: 0, endMs: Math.min(3000, durationMs), summary: "模型没给出完整报告，已按时长生成可复刻骨架。" },
        structure: [
          { name: "钩子", startMs: 0, endMs: Math.min(3000, durationMs), note: "前 3 秒" },
          { name: "展开", startMs: Math.min(3000, durationMs), endMs: durationMs, note: "" },
        ],
        shots: frames.map((f, i) => ({
          startMs: f.tMs,
          endMs: frames[i + 1]?.tMs ?? durationMs,
          visual: `抽帧 ${i + 1}`,
          line: "未见转写",
        })),
        rhythm: { shotCount: frames.length, avgShotMs: Math.round(durationMs / Math.max(1, frames.length)), wordsPerSec: null, note: msg },
        viralFactors: [],
        template: fallbackTemplate(title, durationMs),
      };
    } else {
      throw e;
    }
  }
  if (doc.template.slots.length === 0) doc.template = fallbackTemplate(title, durationMs);

  const report: AnalysisReport = {
    id,
    sourceUrl,
    videoAssetId,
    title: doc.title || title,
    report: doc,
    frames,
    transcript,
    createdAt: now(),
  };
  db.run(
    `INSERT INTO analysis_reports (id, sourceUrl, videoAssetId, title, reportJson, framesJson, transcript, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [report.id, report.sourceUrl, report.videoAssetId, report.title, JSON.stringify(report.report), JSON.stringify(frames), transcript, report.createdAt],
  );
  ctx.progress(1, "报告已出");
  return { reportId: id, title: report.title };
};

export function readFrame(reportId: string, file: string): Uint8Array | null {
  const abs = frameAbs(reportId, file);
  if (!existsSync(abs)) return null;
  return new Uint8Array(readFileSync(abs));
}
