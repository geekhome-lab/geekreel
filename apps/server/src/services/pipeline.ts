import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  emptyTimelineDoc,
  formatSrt,
  sanitizeTitle,
  type DramaBible,
  type PipelineRun,
  type SrtCue,
} from "@vw/core";
import { detectBins, paperStill } from "@vw/media";
import { getAdapter } from "@vw/models";
import { injectImagePrompt, type LoadedPack } from "@vw/style";
import {
  bibleFromWhiteboard,
  novelDramaPrompt,
  NOVEL_DRAMA_SYSTEM,
  parseDramaBible,
  scenesFromInput,
  stitchEpisodeFrames,
  type WhiteboardScene,
} from "@vw/pipeline";
import { db } from "../db";
import type { JobContext, JobHandler } from "../jobs/queue";
import { newId, now } from "../lib/resp";
import { libraryRoot, storeAsset } from "./library";
import { resolveEndpoint } from "./models";
import { loadPack } from "./styles";

interface PipeRow {
  id: string;
  projectId: string;
  templateId: string;
  packId: string | null;
  status: string;
  currentStep: string;
  stateJson: string;
  createdAt: number;
  updatedAt: number;
}

function rowToRun(row: PipeRow): PipelineRun {
  let bible: DramaBible | null = null;
  try {
    const state = JSON.parse(row.stateJson) as { bible?: DramaBible };
    bible = state.bible ?? null;
  } catch {
    bible = null;
  }
  return {
    id: row.id,
    projectId: row.projectId,
    templateId: row.templateId,
    packId: row.packId,
    status: row.status,
    currentStep: row.currentStep,
    bible,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listPipelines(projectId?: string): PipelineRun[] {
  const rows = projectId
    ? (db.query("SELECT * FROM pipelines WHERE projectId = ? ORDER BY createdAt DESC LIMIT 20").all(projectId) as PipeRow[])
    : (db.query("SELECT * FROM pipelines ORDER BY createdAt DESC LIMIT 30").all() as PipeRow[]);
  return rows.map(rowToRun);
}

export function getPipeline(id: string): PipelineRun | null {
  const row = db.query("SELECT * FROM pipelines WHERE id = ?").get(id) as PipeRow | null;
  return row ? rowToRun(row) : null;
}

function createQuickProject(name: string, packId: string | null): { id: string; directory: string; name: string } {
  const id = newId();
  const d = new Date();
  const mmdd = `${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const hash = id.replace(/-/g, "").slice(0, 4);
  const dir = join(libraryRoot(), "projects", `${mmdd}_${sanitizeTitle(name, 24)}_${hash}`);
  mkdirSync(join(dir, "canvas"), { recursive: true });
  mkdirSync(join(dir, "pipeline"), { recursive: true });
  mkdirSync(join(dir, "export"), { recursive: true });
  const t = now();
  writeFileSync(
    join(dir, "project.vw.json"),
    JSON.stringify({ id, name, version: 1, source: "pipeline", stylePackId: packId, createdAt: new Date(t).toISOString() }, null, 2),
  );
  db.run(
    "INSERT INTO projects (id, name, directory, stylePackId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
    [id, name, dir, packId, t, t],
  );
  return { id, directory: dir, name };
}

function writeCanvas(projectId: string, dir: string, bible: DramaBible, imageEndpointId: string | null) {
  const nodes: unknown[] = [];
  const edges: unknown[] = [];
  bible.episodes.forEach((ep, ei) => {
    nodes.push({
      id: `ep_${ei}`,
      type: "textNode",
      position: { x: 40, y: 40 + ei * 380 },
      data: { text: `第${ep.index}集 ${ep.title}\n${ep.narrator || ep.synopsis}` },
    });
    ep.shots.forEach((shot, si) => {
      const x = 360 + si * 620;
      const y = 20 + ei * 380;
      const textId = `t_${ei}_${si}`;
      const genId = `g_${ei}_${si}`;
      const prompt = [shot.imagePrompt, shot.line && `字幕：${shot.line}`].filter(Boolean).join("。");
      nodes.push(
        { id: textId, type: "textNode", position: { x, y: y + 40 }, data: { text: prompt } },
        {
          id: genId,
          type: "imageGenNode",
          position: { x: x + 300, y },
          data: { prompt: "", size: "1024x1024", endpointId: imageEndpointId, status: "idle" },
        },
      );
      edges.push({ id: `e_${ei}_${si}`, source: textId, sourceHandle: "out", target: genId, targetHandle: "prompt", animated: true });
    });
  });

  const existing = db.query("SELECT id, path FROM canvas_docs WHERE projectId = ? ORDER BY updatedAt DESC LIMIT 1").get(projectId) as
    | { id: string; path: string }
    | null;
  const t = now();
  const rel = existing?.path ?? "canvas/主画布.json";
  writeFileSync(join(dir, rel), JSON.stringify({ version: 1, nodes, edges, viewport: null }));
  if (existing) {
    db.run("UPDATE canvas_docs SET updatedAt = ? WHERE id = ?", [t, existing.id]);
  } else {
    db.run("INSERT INTO canvas_docs (id, projectId, name, path, updatedAt) VALUES (?, ?, ?, ?, ?)", [
      newId(), projectId, "主画布", rel, t,
    ]);
  }
}

export const pipelineRunHandler: JobHandler = async (job, ctx) => {
  const payload = JSON.parse(job.payloadJson) as {
    story?: string;
    packId?: string;
    substyle?: string;
    projectId?: string;
    llmEndpointId?: string;
    imageEndpointId?: string;
  };
  const story = payload.story?.trim();
  if (!story) throw new Error("先写一句故事或贴一段小说");

  const pack = payload.packId ? loadPack(payload.packId) : null;
  if (payload.packId && !pack) throw new Error("没找到这套风格。确认 stylePacks/ 里有对应目录。");
  if (pack && !pack.public.ready) throw new Error(pack.public.unavailableReason || "这套风格还不能用");

  const isWhiteboard = pack?.public.id === "whiteboard";
  const whiteboard = isWhiteboard ? scenesFromInput(story) : null;
  if (isWhiteboard && !whiteboard!.scenes.length) {
    throw new Error("没读出内容。贴一段 SRT，或按行写口播。");
  }

  ctx.progress(0.08, "建项目");
  const titleHint = isWhiteboard
    ? whiteboard!.scenes[0]!.text.replace(/\s+/g, " ").slice(0, 16) || "白板动画"
    : story.replace(/\s+/g, " ").slice(0, 16);
  let projectId = payload.projectId;
  let directory = "";
  if (projectId) {
    const row = db.query("SELECT directory FROM projects WHERE id = ?").get(projectId) as { directory: string } | null;
    if (!row) throw new Error("项目不存在");
    directory = row.directory;
  } else {
    const created = createQuickProject(titleHint, pack?.public.id ?? null);
    projectId = created.id;
    directory = created.directory;
  }

  const runId = newId();
  const t0 = now();
  db.run(
    "INSERT INTO pipelines (id, projectId, templateId, packId, status, currentStep, stateJson, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [runId, projectId, isWhiteboard ? "whiteboard" : pack ? "style-drama" : "novel-drama", pack?.public.id ?? null, "running", isWhiteboard ? "scenes" : "bible", "{}", t0, t0],
  );

  if (isWhiteboard && pack && whiteboard) {
    return runWhiteboard({
      runId,
      projectId,
      directory,
      pack,
      story,
      scenes: whiteboard.scenes,
      cues: whiteboard.cues,
      imageEndpointId: payload.imageEndpointId ?? null,
      ctx,
    });
  }

  ctx.progress(0.2, "拆 5 集剧本");
  const endpoint = resolveEndpoint("llm", payload.llmEndpointId);
  if (!endpoint) throw new Error("短剧要文本模型来拆集和色盘。到「模型」页加一个。");
  const adapter = getAdapter(endpoint.adapterType);
  if (!adapter?.chat) throw new Error("这个模型不会聊天，换一个文本模型");

  const packHint = pack
    ? `风格：${pack.public.name}。子风格：${payload.substyle || pack.public.defaultSubstyle || "默认"}。色盘要能平涂，不要写光影。`
    : "通用短剧，画面写清楚主体和动作即可。";
  let bible: DramaBible;
  try {
    const text = await adapter.chat(endpoint.config, {
      system: pack?.bibleSystem || NOVEL_DRAMA_SYSTEM,
      prompt: novelDramaPrompt(story, packHint),
    });
    bible = parseDramaBible(text, story);
  } catch {
    bible = parseDramaBible("", story);
  }

  const substyle = payload.substyle || pack?.public.defaultSubstyle || null;
  bible.packId = pack?.public.id ?? null;
  bible.substyle = substyle;
  bible = stitchEpisodeFrames(bible);

  ctx.progress(0.55, "注入风格和色盘");
  if (pack) {
    let prevLast: string | null = null;
    bible = {
      ...bible,
      episodes: bible.episodes.map((ep) => {
        const shots = ep.shots.map((shot, i) => ({
          ...shot,
          imagePrompt: injectImagePrompt({
            pack,
            raw: shot.imagePrompt || shot.visual,
            palette: bible.palette,
            substyle,
            lastFrame: i === 0 ? prevLast : null,
          }),
        }));
        prevLast = ep.lastFrame || shots.at(-1)?.visual || prevLast;
        return { ...ep, shots };
      }),
      assets: bible.assets.map((a) => ({
        ...a,
        prompt: injectImagePrompt({ pack, raw: a.prompt || a.name, palette: bible.palette, substyle }),
      })),
    };
  }

  mkdirSync(join(directory, "pipeline"), { recursive: true });
  writeFileSync(join(directory, "pipeline/bible.json"), JSON.stringify(bible, null, 2));
  db.run("UPDATE projects SET stylePackId = ?, paletteJson = ?, updatedAt = ? WHERE id = ?", [
    pack?.public.id ?? null,
    JSON.stringify(bible.palette),
    now(),
    projectId,
  ]);

  ctx.progress(0.8, "搭画布");
  writeCanvas(projectId, directory, bible, payload.imageEndpointId ?? null);

  const t1 = now();
  db.run("UPDATE pipelines SET status = ?, currentStep = ?, stateJson = ?, updatedAt = ? WHERE id = ?", [
    "done",
    "canvas",
    JSON.stringify({ bible, story }),
    t1,
    runId,
  ]);
  ctx.progress(1, "5 集初稿已搭好");
  return {
    pipelineId: runId,
    projectId,
    title: bible.title,
    episodeCount: bible.episodes.length,
    shotCount: bible.episodes.reduce((n, e) => n + e.shots.length, 0),
  };
};

async function runWhiteboard(opts: {
  runId: string;
  projectId: string;
  directory: string;
  pack: LoadedPack;
  story: string;
  scenes: WhiteboardScene[];
  cues: SrtCue[];
  imageEndpointId: string | null;
  ctx: JobContext;
}) {
  const { runId, projectId, directory, pack, story, scenes, cues, imageEndpointId, ctx } = opts;

  ctx.progress(0.22, "分幕");
  let bible = bibleFromWhiteboard(scenes[0]?.text ?? "白板动画", scenes);
  bible.packId = pack.public.id;
  bible = {
    ...bible,
    episodes: bible.episodes.map((ep) => ({
      ...ep,
      shots: ep.shots.map((shot) => ({
        ...shot,
        imagePrompt: injectImagePrompt({
          pack,
          raw: shot.imagePrompt || shot.visual,
          palette: bible.palette,
        }),
      })),
    })),
  };

  mkdirSync(join(directory, "pipeline"), { recursive: true });
  mkdirSync(join(directory, "timeline"), { recursive: true });
  writeFileSync(join(directory, "pipeline/bible.json"), JSON.stringify(bible, null, 2));
  db.run("UPDATE projects SET stylePackId = ?, paletteJson = ?, updatedAt = ? WHERE id = ?", [
    pack.public.id,
    JSON.stringify(bible.palette),
    now(),
    projectId,
  ]);

  ctx.progress(0.5, "做纸底");
  const bins = await detectBins();
  if (!bins.available || !bins.ffmpeg) {
    throw new Error("项目自带的 ffmpeg 找不到。把整个项目拷走再试，不要只拷网页。");
  }
  const paperPath = join(directory, "pipeline", "paper.png");
  await paperStill(bins.ffmpeg, paperPath, {
    color: bible.palette.colors[0]?.hex || "#F5EBD7",
    signal: ctx.signal,
  });
  const paper = storeAsset({
    type: "image",
    title: `${bible.title}纸底`,
    ext: "png",
    source: "pipeline",
    projectId,
    fromPath: paperPath,
  });

  ctx.progress(0.78, "上时间线和字幕");
  const endMs = Math.max(2000, ...scenes.map((s) => s.endMs), ...cues.map((c) => c.endMs));
  const doc = emptyTimelineDoc();
  doc.width = 1280;
  doc.height = 720;
  const vTrack = doc.tracks.find((t) => t.type === "video")!;
  const sTrack = doc.tracks.find((t) => t.type === "subtitle")!;
  vTrack.clips.push({
    id: "c_v_0",
    assetId: paper.id,
    startMs: 0,
    inMs: 0,
    outMs: endMs,
    volume: 1,
  });
  const subs: SrtCue[] = cues.length
    ? cues
    : scenes.map((s) => ({ startMs: s.startMs, endMs: s.endMs, text: s.text }));
  subs.forEach((c, i) => {
    sTrack.clips.push({
      id: `c_s_${i}`,
      text: c.text.replace(/\n/g, " ").slice(0, 80),
      startMs: c.startMs,
      inMs: 0,
      outMs: Math.max(500, c.endMs - c.startMs),
      volume: 1,
    });
  });
  writeFileSync(join(directory, "timeline", "main.json"), JSON.stringify(doc, null, 2));
  writeFileSync(join(directory, "pipeline", "input.srt"), formatSrt(subs), "utf-8");

  ctx.progress(0.9, "搭画布");
  writeCanvas(projectId, directory, bible, imageEndpointId);

  const t1 = now();
  db.run("UPDATE pipelines SET status = ?, currentStep = ?, stateJson = ?, updatedAt = ? WHERE id = ?", [
    "done",
    "timeline",
    JSON.stringify({ bible, story, sceneCount: scenes.length, paperAssetId: paper.id }),
    t1,
    runId,
  ]);
  ctx.progress(1, "纸底片子已上时间线");
  return {
    pipelineId: runId,
    projectId,
    title: bible.title,
    sceneCount: scenes.length,
    clipCount: 1,
    hasTimeline: true,
    paperAssetId: paper.id,
  };
}
