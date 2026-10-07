import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extFromFileName, extFromMime, mimeFromExt, type DramaBible, type ScriptDoc, type TimelineDoc } from "@vw/core";
import { detectBins, probe, videoThumbnail } from "@vw/media";
import { getAdapter, type ModelEndpoint } from "@vw/models";
import {
  buildFinishTimeline,
  DUB_FROM_VIDEO_SYSTEM,
  dubFromVideoPrompt,
  dubStoryHint,
  extractDialogue,
  isTalkingShot,
  lineFromClipSource,
  parseDubFromVideo,
  spokenLine,
  splitSpokenCues,
  type DubbedClip,
  type FinishClip,
} from "@vw/pipeline";
import { db } from "../db";
import { jobQueue, type JobHandler } from "../jobs/queue";
import { absInLibrary, storeAsset } from "./library";
import { getEndpoint, listEndpoints, resolveEndpoint } from "./models";
import { loadProjectScript, projectDirectory } from "./scriptStore";
import { chatMetered, recordUsage } from "./usage";

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

function collectFromCanvas(dir: string, projectId: string): FinishClip[] {
  const canvas = loadCanvas(dir, projectId);
  if (!canvas) return [];
  const gen = canvas.nodes
    .filter((n) => n.type === "videoGenNode" && typeof n.data?.assetId === "string")
    .sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0) || (a.position?.x ?? 0) - (b.position?.x ?? 0));
  if (gen.length === 0) return [];

  const byId = new Map(canvas.nodes.map((n) => [n.id, n]));
  const clips = gen.map((n) => {
    const assetId = String(n.data!.assetId);
    const ownLine = typeof n.data?.line === "string" ? n.data.line.trim() : "";
    const nodePrompt = typeof n.data?.prompt === "string" ? n.data.prompt.trim() : "";
    const textEdge = canvas.edges.find((e) => e.target === n.id && (e.targetHandle === "prompt" || !e.targetHandle));
    const textNode = textEdge ? byId.get(textEdge.source) : undefined;
    const prompt = typeof textNode?.data?.text === "string" ? textNode.data.text : "";
    const visual = nodePrompt || prompt;
    const fromPrompt = extractDialogue(visual);
    const line = ownLine || fromPrompt;
    const nodeSec = Number(n.data?.durationSec);
    const fallback = Number.isFinite(nodeSec) && nodeSec > 0 ? nodeSec * 1000 : 5000;
    const durationMs = assetDurationMs(assetId, fallback);
    return { videoAssetId: assetId, durationMs, line, visual, cues: splitSpokenCues(line, durationMs) };
  });
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
      const visual = (shot.visual || shot.imagePrompt || "").trim();
      return [{ videoAssetId: assetId, durationMs, line, visual, cues: splitSpokenCues(line, durationMs) }];
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
  const oneToOne = rows.length === scenes.length && rows.length > 0;
  return rows.map((row, i) => {
    const durationMs = row.durationMs && row.durationMs > 200 ? row.durationMs : 5000;
    const scene = oneToOne ? scenes[i] : undefined;
    const line = scene ? spokenLine(scene) : "";
    const visual = scene ? `${scene.heading}\n${scene.action}`.trim() : "";
    return { videoAssetId: row.id, durationMs, line, visual, cues: splitSpokenCues(line, durationMs) };
  });
}

function bindClipLine(clip: FinishClip): FinishClip {
  const line = lineFromClipSource({ durationMs: clip.durationMs, line: clip.line, visual: clip.visual });
  return {
    ...clip,
    line,
    talking: isTalkingShot({ line, visual: clip.visual }),
    cues: splitSpokenCues(line, clip.durationMs),
  };
}

function mediaBytes(assetId: string, type: "audio" | "video"): { mime: string; data: Uint8Array } | undefined {
  const row = db.query("SELECT path FROM assets WHERE id = ? AND type = ?").get(assetId, type) as { path: string } | null;
  if (!row) return undefined;
  const abs = absInLibrary(row.path);
  if (!existsSync(abs)) return undefined;
  const ext = extFromFileName(row.path) || (type === "audio" ? "mp3" : "mp4");
  return { mime: mimeFromExt(ext), data: new Uint8Array(readFileSync(abs)) };
}

export function collectFinishClips(projectId: string): FinishClip[] {
  const dir = projectDirectory(projectId);
  if (!dir) throw new Error("项目不存在");
  const script = loadProjectScript(projectId);
  const fromCanvas = collectFromCanvas(dir, projectId);
  const raw = fromCanvas.length ? fromCanvas : collectFromProjectVideos(projectId, script);
  const clips = raw.length ? raw : collectFromBible(dir);
  return clips.map(bindClipLine);
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

function resolveDubLlm(): ModelEndpoint | null {
  const all = listEndpoints("llm").filter((e) => e.enabled);
  const pick = all.find((e) => e.vision) ?? all[0];
  return pick ? getEndpoint(pick.id, true) : null;
}

function frameTimes(durationMs: number): number[] {
  const d = Math.max(400, durationMs);
  if (d < 1500) return [Math.round(d * 0.4)];
  if (d < 4000) return [Math.round(d * 0.18), Math.round(d * 0.78)];
  return [Math.round(d * 0.12), Math.round(d * 0.5), Math.round(d * 0.88)];
}

async function grabClipFrames(
  ffmpeg: string,
  assetId: string,
  durationMs: number,
  signal?: AbortSignal,
): Promise<Array<{ mime: string; data: Uint8Array }>> {
  const row = db.query("SELECT path FROM assets WHERE id = ?").get(assetId) as { path: string } | null;
  if (!row) return [];
  const abs = absInLibrary(row.path);
  if (!existsSync(abs)) return [];
  const tmp = mkdtempSync(join(tmpdir(), "vw-dub-"));
  try {
    const out: Array<{ mime: string; data: Uint8Array }> = [];
    for (const [i, at] of frameTimes(durationMs).entries()) {
      const file = join(tmp, `f${i}.jpg`);
      try {
        await videoThumbnail(ffmpeg, abs, file, at, signal);
        if (existsSync(file)) out.push({ mime: "image/jpeg", data: new Uint8Array(readFileSync(file)) });
      } catch {
        /* 这一帧抽失败就跳过 */
      }
    }
    return out;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function linesFromVideos(
  clips: FinishClip[],
  opts: {
    projectId: string;
    storyHint?: string;
    signal?: AbortSignal;
    onProgress?: (i: number, n: number) => void;
  },
): Promise<FinishClip[]> {
  const llm = resolveDubLlm();
  const adapter = llm ? getAdapter(llm.adapterType) : null;
  const bins = await detectBins();
  const out: FinishClip[] = [];
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i]!;
    opts.onProgress?.(i, clips.length);
    let line = lineFromClipSource({ durationMs: clip.durationMs, line: clip.line, visual: clip.visual });
    if (adapter?.chat && llm) {
      try {
        const images = llm.vision && bins.ffmpeg ? await grabClipFrames(bins.ffmpeg, clip.videoAssetId, clip.durationMs, opts.signal) : [];
        const text = await chatMetered(
          adapter,
          llm,
          {
            system: DUB_FROM_VIDEO_SYSTEM,
            prompt: dubFromVideoPrompt({
              durationMs: clip.durationMs,
              visual: clip.visual,
              storyHint: opts.storyHint,
              draft: line,
            }),
            images: images.length ? images : undefined,
          },
          { projectId: opts.projectId, jobType: "timeline.dub" },
        );
        const parsed = parseDubFromVideo(text, clip.durationMs);
        line = parsed.silent ? "" : parsed.line || line;
      } catch {
        /* 用这一镜自己的词 */
      }
    }
    out.push({
      ...clip,
      line,
      talking: isTalkingShot({ line, visual: clip.visual }),
      cues: splitSpokenCues(line, clip.durationMs),
    });
  }
  return out;
}

async function lipSyncTalkingClips(
  clips: FinishClip[],
  dubbed: DubbedClip[],
  opts: {
    projectId: string;
    signal?: AbortSignal;
    onProgress?: (i: number, n: number) => void;
  },
): Promise<FinishClip[]> {
  const talking = clips.filter((c, i) => c.talking && c.line.trim() && dubbed[i]?.assetId);
  if (!talking.length) return clips;
  const videoEp = resolveEndpoint("video");
  const adapter = videoEp ? getAdapter(videoEp.adapterType) : null;
  if (!videoEp || (!adapter?.lipSync && !adapter?.generateVideo)) return clips;
  const bins = await detectBins();
  const out = clips.map((c) => ({ ...c }));
  for (let i = 0; i < out.length; i++) {
    const clip = out[i]!;
    const voice = dubbed[i];
    if (!clip.talking || !clip.line.trim() || !voice?.assetId) continue;
    opts.onProgress?.(i, out.length);
    const audio = mediaBytes(voice.assetId, "audio");
    const film = mediaBytes(clip.videoAssetId, "video");
    let still: { mime: string; data: Uint8Array } | undefined;
    if (bins.ffmpeg) {
      const frames = await grabClipFrames(bins.ffmpeg, clip.videoAssetId, clip.durationMs, opts.signal).catch(() => []);
      still = frames[0];
    }
    if (!audio || (!still && !film)) continue;
    try {
      const durSec = Math.max(3, Math.round(clip.durationMs / 1000) || 5);
      const lip = adapter.lipSync
        ? await adapter.lipSync(videoEp.config, {
            image: still,
            video: film,
            audio,
            text: clip.line,
            durationSec: durSec,
            signal: opts.signal,
          })
        : await adapter.generateVideo!(videoEp.config, {
            prompt: `角色对着镜头说：「${clip.line}」。嘴型必须对上这句，能出声就一起出声。`,
            durationSec: durSec,
            image: still,
            dialogue: clip.line,
            audio: true,
            voice: audio,
            signal: opts.signal,
          });
      const asset = storeAsset({
        type: "video",
        title: clip.line.slice(0, 16) || "对口型",
        ext: extFromMime(lip.mime, "mp4"),
        source: "pipeline",
        projectId: opts.projectId,
        data: lip.data,
      });
      recordUsage({
        endpoint: videoEp,
        projectId: opts.projectId,
        jobType: "timeline.lipsync",
        videoSec: lip.durationSec ?? durSec,
      });
      out[i] = { ...clip, videoAssetId: asset.id, durationMs: (lip.durationSec ?? durSec) * 1000 };
    } catch {
      /* 铺声，嘴可能对不上 */
    }
  }
  return out;
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
  let clips = collectFinishClips(input.projectId);
  if (clips.length === 0) {
    throw new Error("还没有视频。先出片，再配音。");
  }
  const shouldDub = input.dub === true;
  if (shouldDub) {
    input.onProgress?.(0.12, `在看 ${clips.length} 镜成片写词`);
    clips = await linesFromVideos(clips, {
      projectId: input.projectId,
      storyHint: dubStoryHint(loadProjectScript(input.projectId)),
      signal: input.signal,
      onProgress: (i, n) => input.onProgress?.(0.12 + (i / Math.max(1, n)) * 0.2, `在看第 ${i + 1} 镜画面`),
    });
  } else {
    input.onProgress?.(0.15, "在装画面和字幕");
  }
  const { dubbed, missingTts } = shouldDub
    ? await speakLines(
        clips.map((c) => c.line),
        {
          projectId: input.projectId,
          endpointId: input.ttsEndpointId,
          voice: input.voice,
          signal: input.signal,
          onProgress: (i, n) => input.onProgress?.(0.32 + (i / Math.max(1, n)) * 0.28, `配音 ${i + 1}/${n}`),
        },
      )
    : { dubbed: clips.map(() => ({ assetId: "", durationMs: 0 })), missingTts: false };
  if (shouldDub && dubbed.some((d) => d.assetId) && clips.some((c) => c.talking)) {
    input.onProgress?.(0.62, "对白镜在对口型");
    clips = await lipSyncTalkingClips(clips, dubbed, {
      projectId: input.projectId,
      signal: input.signal,
      onProgress: (i, n) => input.onProgress?.(0.62 + (i / Math.max(1, n)) * 0.28, `第 ${i + 1} 镜对口型`),
    });
  }
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
      ? `已按成片配 ${result.dubbed} 段。对白镜会再对嘴`
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
