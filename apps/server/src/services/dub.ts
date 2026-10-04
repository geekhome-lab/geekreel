import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DramaBible, ScriptDoc, TimelineDoc } from "@vw/core";
import { detectBins, probe } from "@vw/media";
import { getAdapter, type ModelEndpoint } from "@vw/models";
import { buildFinishTimeline, cuesFromScenes, extractDialogue, fitCuesToClips, spokenLine, splitSpokenCues, type DubbedClip, type FinishClip } from "@vw/pipeline";
import { db } from "../db";
import { jobQueue, type JobHandler } from "../jobs/queue";
import { absInLibrary, storeAsset } from "./library";
import { resolveEndpoint } from "./models";
import { loadProjectScript, projectDirectory } from "./scriptStore";
import { recordUsage } from "./usage";

type CanvasNode = {
  id: string;
  type?: string;
  position?: { x?: number; y?: number };
  data?: Record<string, unknown>;
};

function isPortraitProject(projectId: string): boolean {
  const proj = db.query("SELECT seriesId FROM projects WHERE id = ?").get(projectId) as { seriesId: string | null } | null;
  if (!proj?.seriesId) return true;
  const series = db.query("SELECT kind FROM series WHERE id = ?").get(proj.seriesId) as { kind: string } | null;
  return series?.kind === "drama" || series?.kind === "free" || series?.kind === "whiteboard";
}

function loadCanvas(dir: string, projectId: string): { nodes: CanvasNode[]; edges: Array<{ source: string; target: string; targetHandle?: string }> } | null {
  const canvasRow = db
    .query("SELECT path FROM canvas_docs WHERE projectId = ? ORDER BY updatedAt DESC LIMIT 1")
    .get(projectId) as { path: string } | null;
  if (!canvasRow) return null;
  const abs = join(dir, canvasRow.path);
  if (!existsSync(abs)) return null;
  try {
    const canvas = JSON.parse(readFileSync(abs, "utf8")) as {
      nodes?: CanvasNode[];
      edges?: Array<{ source: string; target: string; targetHandle?: string }>;
    };
    return { nodes: canvas.nodes ?? [], edges: canvas.edges ?? [] };
  } catch {
    return null;
  }
}

function assetDurationMs(assetId: string, fallback: number): number {
  const row = db.query("SELECT durationMs, type FROM assets WHERE id = ?").get(assetId) as
    | { durationMs: number | null; type: string }
    | null;
  if (row?.durationMs && row.durationMs > 200) return row.durationMs;
  return fallback;
}

function collectFromCanvas(dir: string, projectId: string, script: ScriptDoc | null): FinishClip[] {
  const canvas = loadCanvas(dir, projectId);
  if (!canvas) return [];
  const gen = canvas.nodes
    .filter((n) => n.type === "videoGenNode" && typeof n.data?.assetId === "string")
    .sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0) || (a.position?.x ?? 0) - (b.position?.x ?? 0));
  if (gen.length === 0) return [];

  const byId = new Map(canvas.nodes.map((n) => [n.id, n]));
  const clips = gen.map((n, i) => {
    const assetId = String(n.data!.assetId);
    const ownLine = typeof n.data?.line === "string" ? n.data.line.trim() : "";
    const textEdge = canvas.edges.find((e) => e.target === n.id && (e.targetHandle === "prompt" || !e.targetHandle));
    const textNode = textEdge ? byId.get(textEdge.source) : undefined;
    const prompt = typeof textNode?.data?.text === "string" ? textNode.data.text : "";
    const fromPrompt = extractDialogue(prompt);
    const fromScript = script?.scenes[i] ? spokenLine(script.scenes[i]!) : "";
    const line = ownLine || fromPrompt || fromScript;
    const nodeSec = Number(n.data?.durationSec);
    const fallback = Number.isFinite(nodeSec) && nodeSec > 0 ? nodeSec * 1000 : 5000;
    const durationMs = assetDurationMs(assetId, fallback);
    return { videoAssetId: assetId, durationMs, line, cues: splitSpokenCues(line, durationMs) };
  });
  if (clips.length === 1 && (script?.scenes.length ?? 0) > 1) {
    const durationMs = clips[0]!.durationMs;
    const line = script!.scenes.map((s) => spokenLine(s)).filter(Boolean).join("\n");
    return [{ ...clips[0]!, line, cues: cuesFromScenes(script!.scenes, durationMs) }];
  }
  return clips;
}

function collectFromBible(dir: string): FinishClip[] {
  const path = join(dir, "pipeline", "bible.json");
  if (!existsSync(path)) return [];
  try {
    const bible = JSON.parse(readFileSync(path, "utf8")) as DramaBible;
    const ep = bible.episodes.at(-1);
    if (!ep) return [];
    return ep.shots.flatMap((shot) => {
      const assetId = shot.videoAssetId;
      if (!assetId) return [];
      const fallback = Math.max(400, Math.round(((shot.endSec ?? 0) - (shot.startSec ?? 0)) * 1000) || 5000);
      const durationMs = assetDurationMs(assetId, fallback);
      const line = (shot.line ?? "").trim();
      return [{ videoAssetId: assetId, durationMs, line, cues: splitSpokenCues(line, durationMs) }];
    });
  } catch {
    return [];
  }
}

export async function speakLines(
  lines: string[],
  opts: { projectId: string; endpointId?: string; voice?: string; signal?: AbortSignal; onProgress?: (i: number, n: number) => void },
): Promise<{ dubbed: DubbedClip[]; missingTts: boolean }> {
  const need = lines.some((l) => l.trim());
  if (!need) return { dubbed: lines.map(() => ({ assetId: "", durationMs: 0 })), missingTts: false };

  const endpoint = resolveEndpoint("tts", opts.endpointId);
  const adapter = endpoint ? getAdapter(endpoint.adapterType) : null;
  if (!endpoint || !adapter?.generateSpeech) {
    return { dubbed: lines.map(() => ({ assetId: "", durationMs: 0 })), missingTts: true };
  }

  const bins = await detectBins();
  const dubbed: DubbedClip[] = [];
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!.trim();
    opts.onProgress?.(i, lines.length);
    if (!text) {
      dubbed.push({ assetId: "", durationMs: 0 });
      continue;
    }
    const speech = await adapter.generateSpeech(endpoint.config, { text, voice: opts.voice, signal: opts.signal });
    const ext = speech.mime.includes("wav") ? "wav" : "mp3";
    const asset = storeAsset({
      type: "audio",
      title: text.slice(0, 20) || "配音",
      ext,
      source: "tts",
      projectId: opts.projectId,
      data: speech.data,
    });
    let durationMs = 0;
    if (bins.ffprobe) {
      try {
        const info = await probe(bins.ffprobe, absInLibrary(asset.path));
        durationMs = info?.durationMs ?? 0;
        if (durationMs) db.run("UPDATE assets SET durationMs = ? WHERE id = ?", [durationMs, asset.id]);
      } catch {
        /* 用画面时长 */
      }
    }
    recordUsage({
      endpoint,
      projectId: opts.projectId,
      jobType: "timeline.finish",
      audioChars: text.length,
    });
    dubbed.push({ assetId: asset.id, durationMs });
  }
  return { dubbed, missingTts: false };
}

function writeTimeline(dir: string, doc: TimelineDoc) {
  mkdirSync(join(dir, "timeline"), { recursive: true });
  writeFileSync(join(dir, "timeline", "main.json"), JSON.stringify(doc, null, 2));
}

function collectFromProjectVideos(projectId: string, script: ScriptDoc | null): FinishClip[] {
  const rows = db
    .query(
      "SELECT id, durationMs FROM assets WHERE projectId = ? AND type = 'video' AND source IN ('canvas', 'pipeline') ORDER BY createdAt ASC",
    )
    .all(projectId) as Array<{ id: string; durationMs: number | null }>;
  const scenes = script?.scenes ?? [];
  if (rows.length === 1) {
    const durationMs = rows[0]!.durationMs && rows[0]!.durationMs > 200 ? rows[0]!.durationMs : 5000;
    const line = scenes.map((s) => spokenLine(s)).filter(Boolean).join("\n");
    return [
      {
        videoAssetId: rows[0]!.id,
        durationMs,
        line,
        cues: cuesFromScenes(scenes, durationMs),
      },
    ];
  }
  return rows.map((row, i) => {
    const durationMs = row.durationMs && row.durationMs > 200 ? row.durationMs : 5000;
    const line = scenes[i] ? spokenLine(scenes[i]!) : "";
    return { videoAssetId: row.id, durationMs, line, cues: splitSpokenCues(line, durationMs) };
  });
}

export function collectFinishClips(projectId: string): FinishClip[] {
  const dir = projectDirectory(projectId);
  if (!dir) throw new Error("项目不存在");
  const script = loadProjectScript(projectId);
  const fromCanvas = collectFromCanvas(dir, projectId, script);
  const raw = fromCanvas.length ? fromCanvas : collectFromProjectVideos(projectId, script);
  const clips = raw.length ? raw : collectFromBible(dir);
  if (script?.scenes.length) return fitCuesToClips(clips, script.scenes);
  return clips;
}

export function maybeEnqueueFinish(projectId: string, withSubtitles = true): void {
  const have = collectFinishClips(projectId);
  if (have.length === 0) return;
  const dir = projectDirectory(projectId);
  const canvas = dir ? loadCanvas(dir, projectId) : null;
  const nodeCount = canvas?.nodes.filter((n) => n.type === "videoGenNode").length ?? 0;
  const sceneCount = loadProjectScript(projectId)?.scenes.length ?? 0;
  // 以剧本场次数为准。画布上多出来的空节点不能挡住配音。
  const expected = sceneCount || nodeCount || 1;
  if (have.length < expected) return;
  const busy = db
    .query(
      "SELECT id FROM jobs WHERE projectId = ? AND type = 'timeline.finish' AND status IN ('queued', 'running') LIMIT 1",
    )
    .get(projectId) as { id: string } | null;
  if (busy) return;
  jobQueue.submit("timeline.finish", { projectId, withSubtitles, dub: false }, projectId);
}

export async function finishTimeline(input: {
  projectId: string;
  withSubtitles?: boolean;
  dub?: boolean;
  voice?: string;
  ttsEndpointId?: string;
  signal?: AbortSignal;
  onProgress?: (ratio: number, message: string) => void;
}): Promise<{ doc: TimelineDoc; clipCount: number; dubbed: number; subtitled: number; missingTts: boolean }> {
  const dir = projectDirectory(input.projectId);
  if (!dir) throw new Error("项目不存在");
  const clips = collectFinishClips(input.projectId);
  if (clips.length === 0) {
    throw new Error("还没有视频。先出片，再配音。");
  }
  const shouldDub = input.dub === true;
  input.onProgress?.(0.15, shouldDub ? `在给 ${clips.length} 镜配音` : "在装画面和字幕");
  const { dubbed, missingTts } = shouldDub
    ? await speakLines(
        clips.map((c) => c.line),
        {
          projectId: input.projectId,
          endpointId: input.ttsEndpointId,
          voice: input.voice,
          signal: input.signal,
          onProgress: (i, n) => input.onProgress?.(0.15 + (i / Math.max(1, n)) * 0.75, `配音 ${i + 1}/${n}`),
        },
      )
    : { dubbed: clips.map(() => ({ assetId: "", durationMs: 0 })), missingTts: false };
  const doc = buildFinishTimeline(clips, {
    portrait: isPortraitProject(input.projectId),
    withSubtitles: input.withSubtitles !== false,
    dubbed,
  });
  writeTimeline(dir, doc);
  const dubbedCount = dubbed.filter((d) => d.assetId).length;
  const subtitled = doc.tracks.find((t) => t.type === "subtitle")?.clips.length ?? 0;
  return { doc, clipCount: clips.length, dubbed: dubbedCount, subtitled, missingTts };
}

export const timelineFinishHandler: JobHandler = async (job, ctx) => {
  const payload = JSON.parse(job.payloadJson) as {
    projectId?: string;
    withSubtitles?: boolean;
    dub?: boolean;
    voice?: string;
    ttsEndpointId?: string;
  };
  const projectId = payload.projectId ?? job.projectId;
  if (!projectId) throw new Error("缺少项目");
  const result = await finishTimeline({
    projectId,
    withSubtitles: payload.withSubtitles,
    dub: payload.dub === true,
    voice: payload.voice,
    ttsEndpointId: payload.ttsEndpointId,
    signal: ctx.signal,
    onProgress: (ratio, message) => ctx.progress(ratio, message),
  });
  const note = result.missingTts
    ? "画面和字幕已装上。还没有语音模型，到「模型」页加一个再选音色。"
    : result.dubbed
      ? `已配 ${result.dubbed} 段，时间线可微调`
      : "画面和字幕已装上。到时间线选音色再配音。";
  ctx.progress(1, note);
  return result;
};

export async function speakOne(
  text: string,
  opts: { projectId?: string | null; endpoint?: ModelEndpoint | null; voice?: string; signal?: AbortSignal },
): Promise<{ assetId: string; durationMs: number } | null> {
  const line = text.trim();
  if (!line) return null;
  const endpoint = opts.endpoint ?? resolveEndpoint("tts");
  const adapter = endpoint ? getAdapter(endpoint.adapterType) : null;
  if (!endpoint || !adapter?.generateSpeech) return null;
  const speech = await adapter.generateSpeech(endpoint.config, { text: line, voice: opts.voice, signal: opts.signal });
  const ext = speech.mime.includes("wav") ? "wav" : "mp3";
  const asset = storeAsset({
    type: "audio",
    title: line.slice(0, 16) || "配音",
    ext,
    source: "pipeline",
    projectId: opts.projectId,
    data: speech.data,
  });
  let durationMs = 0;
  try {
    const bins = await detectBins();
    if (bins.ffprobe) {
      const info = await probe(bins.ffprobe, absInLibrary(asset.path));
      durationMs = info?.durationMs ?? 0;
      if (durationMs) db.run("UPDATE assets SET durationMs = ? WHERE id = ?", [durationMs, asset.id]);
    }
  } catch {
    /* 用画面时长 */
  }
  recordUsage({ endpoint, projectId: opts.projectId, jobType: "pipeline.episode", audioChars: line.length });
  return { assetId: asset.id, durationMs };
}
