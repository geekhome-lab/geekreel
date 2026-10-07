import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  emptyTimelineDoc,
  formatSrt,
  sanitizeTitle,
  type CharacterDossier,
  type DramaBible,
  type PipelineRun,
  type SrtCue,
} from "@vw/core";
import { detectBins, paperStill } from "@vw/media";
import { getAdapter } from "@vw/models";
import { injectImagePrompt, type LoadedPack } from "@vw/style";
import {
  lockProductionIntoPrompt,
  assetsFromCast,
  finishBible,
  bibleFromCastPrompt,
  bibleFromWhiteboard,
  CAST_REVISE_SYSTEM,
  CAST_SYSTEM,
  CAST_TO_BIBLE_SYSTEM,
  castFromAssets,
  clipNovel,
  EVENT_REVISE_SYSTEM,
  fetchNovelText,
  novelCastContinuePrompt,
  novelCastPrompt,
  parseCastDoc,
  parseDramaBible,
  parseBibleRevise,
  parseOneCharacter,
  parseOneEvent,
  BIBLE_REVISE_SYSTEM,
  STORY_REWRITE_SYSTEM,
  reviseBiblePrompt,
  reviseCharacterPrompt,
  reviseEventPrompt,
  rewriteStoryPrompt,
  scenesFromInput,
  stitchEpisodeFrames,
  type WhiteboardScene,
} from "@vw/pipeline";
import { db } from "../db";
import { jobQueue, type JobContext, type JobHandler } from "../jobs/queue";
import { newId, now } from "../lib/resp";
import { libraryRoot, storeAsset, updateAssetMeta } from "./library";
import { resolveEndpoint } from "./models";
import { attachEpisode, createSeries, getSeries, seriesBible } from "./series";
import { loadPack } from "./styles";
import { chatMetered } from "./usage";
import { paintCastViews, paintExtraViews } from "./entityArt";

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
      const prev = si > 0 ? ep.shots[si - 1] : ei > 0 ? bible.episodes[ei - 1]?.shots.at(-1) : undefined;
      const prompt = lockProductionIntoPrompt({
        prompt: shot.imagePrompt || shot.visual,
        bible,
        entityIds: shot.entityIds,
        lastFrame: prev?.visual ?? null,
        dialogue: shot.line || null,
        shot,
      });
      const talking = Boolean(shot.line?.trim());
      nodes.push(
        { id: textId, type: "textNode", position: { x, y: y + 40 }, data: { text: prompt } },
        talking
          ? {
              id: genId,
              type: "videoGenNode",
              position: { x: x + 300, y },
              data: { prompt: "", durationSec: Math.max(3, (shot.endSec ?? 5) - (shot.startSec ?? 0)), endpointId: null, status: "idle" },
            }
          : {
              id: genId,
              type: "imageGenNode",
              position: { x: x + 300, y },
              data: { prompt: "", size: "1024x1536", endpointId: imageEndpointId, status: "idle" },
            },
      );
      edges.push({ id: `e_${ei}_${si}`, source: textId, sourceHandle: "out", target: genId, targetHandle: "prompt", animated: true });
      const face = (bible.cast ?? []).find((c) => c.imageAssetId && (shot.visual.includes(c.name) || shot.line.includes(c.name) || shot.imagePrompt.includes(c.name)))
        ?? (bible.cast ?? []).find((c) => c.imageAssetId);
      if (face?.imageAssetId && talking) {
        const aid = `a_${ei}_${si}`;
        nodes.push({
          id: aid,
          type: "assetNode",
          position: { x: x + 300, y: y + 220 },
          data: { assetId: face.imageAssetId },
        });
        edges.push({ id: `ea_${ei}_${si}`, source: aid, target: genId, targetHandle: "image", animated: true });
      }
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
    url?: string;
    packId?: string;
    substyle?: string;
    projectId?: string;
    llmEndpointId?: string;
    imageEndpointId?: string;
    seriesId?: string;
    seriesName?: string;
    kind?: "drama" | "free" | "whiteboard";
    checkpoint?: boolean;
  };
  let story = payload.story?.trim() ?? "";
  if (!story && payload.url?.trim()) {
    ctx.progress(0.04, "打开小说链接");
    const doc = await fetchNovelText(payload.url.trim(), ctx.signal);
    story = doc.text;
  }
  story = clipNovel(story).text;
  if (!story) throw new Error("先上传小说、贴一段正文，或给一个能直接打开的链接");

  const existingSeries = payload.seriesId ? getSeries(payload.seriesId) : null;
  const lockedBible = existingSeries ? seriesBible(existingSeries) : null;
  const continuing = !!(lockedBible && (existingSeries?.episodeCount ?? 0) > 0);
  if (payload.seriesId && !existingSeries) throw new Error("这部连载不存在");

  const packId = payload.packId || existingSeries?.stylePackId || undefined;
  const pack = packId ? loadPack(packId) : null;
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
    const result = await runWhiteboard({
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
    let seriesId = existingSeries?.id ?? null;
    let episodeIndex: number | null = null;
    if (seriesId) {
      episodeIndex = attachEpisode(seriesId, projectId, null, null);
    } else if (payload.seriesName?.trim()) {
      const created = createSeries({
        name: payload.seriesName.trim(),
        kind: "whiteboard",
        stylePackId: "whiteboard",
      });
      seriesId = created.id;
      episodeIndex = attachEpisode(seriesId, projectId, null, null);
    }
    return { ...result, seriesId, episodeIndex };
  }

  ctx.progress(0.2, continuing ? "通读新章，抽事件" : "通读全文，认人物");
  const endpoint = resolveEndpoint("llm", payload.llmEndpointId);
  if (!endpoint) throw new Error("短剧要文本模型来认人物和拆事件。到「模型」页加一个。");
  const adapter = getAdapter(endpoint.adapterType);
  if (!adapter?.chat) throw new Error("这个模型不会聊天，换一个文本模型");

  const substyle = payload.substyle || existingSeries?.substyle || pack?.public.defaultSubstyle || null;
  const lockedCast = lockedBible?.cast?.length ? lockedBible.cast : lockedBible ? castFromAssets(lockedBible.assets) : [];

  let bible: DramaBible;
  try {
    if (continuing && lockedBible && existingSeries) {
      const text = await chatMetered(
        adapter,
        endpoint,
        {
          system: CAST_SYSTEM,
          prompt: novelCastContinuePrompt(story, {
            title: lockedBible.title || existingSeries.name,
            castLine: lockedCast.map((c) => `${c.id}${c.name}`).join("、"),
          }),
        },
        { projectId, jobType: "pipeline.cast" },
      );
      const doc = parseCastDoc(text, story);
      bible = {
        title: lockedBible.title || doc.title,
        packId: lockedBible.packId,
        substyle: lockedBible.substyle,
        palette: lockedBible.palette.colors.length ? lockedBible.palette : { note: doc.paletteNote, colors: doc.colors.length ? doc.colors : lockedBible.palette.colors },
        cast: lockedCast,
        events: doc.events,
        assets: assetsFromCast(lockedCast, lockedBible.assets),
        episodes: [],
      };
    } else {
      const text = await chatMetered(
        adapter,
        endpoint,
        { system: CAST_SYSTEM, prompt: novelCastPrompt(story) },
        { projectId, jobType: "pipeline.cast" },
      );
      const doc = parseCastDoc(text, story);
      bible = {
        title: doc.title,
        packId: pack?.public.id ?? null,
        substyle,
        palette: { note: doc.paletteNote, colors: doc.colors.length ? doc.colors : parseDramaBible("", story).palette.colors },
        cast: doc.cast,
        events: doc.events,
        assets: assetsFromCast(doc.cast, doc.extras),
        episodes: [],
      };
    }
  } catch {
    const doc = parseCastDoc("", story);
    bible = {
      title: lockedBible?.title || doc.title,
      packId: pack?.public.id ?? lockedBible?.packId ?? null,
      substyle,
      palette: lockedBible?.palette ?? { note: doc.paletteNote, colors: doc.colors },
      cast: lockedCast.length ? lockedCast : doc.cast,
      events: doc.events,
      assets: assetsFromCast(lockedCast.length ? lockedCast : doc.cast, lockedBible?.assets ?? doc.extras),
      episodes: [],
    };
  }

  ctx.progress(0.65, "给出场人物和场景的多视图定妆");
  bible.cast = await paintCast(projectId, bible.cast ?? [], payload.imageEndpointId);
  const extras = (bible.assets ?? []).filter((a) => a.kind !== "character");
  const paintedExtras = await paintExtraViews(projectId, extras, payload.imageEndpointId);
  bible.assets = assetsFromCast(bible.cast, paintedExtras);

  mkdirSync(join(directory, "pipeline"), { recursive: true });
  writeFileSync(join(directory, "pipeline/bible.json"), JSON.stringify(bible, null, 2));
  db.run("UPDATE projects SET stylePackId = ?, paletteJson = ?, updatedAt = ? WHERE id = ?", [
    pack?.public.id ?? null,
    JSON.stringify(bible.palette),
    now(),
    projectId,
  ]);

  const input = {
    story,
    packId: pack?.public.id ?? null,
    substyle,
    seriesId: existingSeries?.id ?? null,
    seriesName: payload.seriesName ?? null,
    kind: payload.kind ?? "drama",
    imageEndpointId: payload.imageEndpointId ?? null,
    llmEndpointId: payload.llmEndpointId ?? null,
  };

  if (payload.checkpoint !== false && !isWhiteboard) {
    db.run("UPDATE pipelines SET status = ?, currentStep = ?, stateJson = ?, updatedAt = ? WHERE id = ?", [
      "waiting",
      "cast",
      JSON.stringify({ bible, story, input }),
      now(),
      runId,
    ]);
    ctx.progress(1, "人物和事件已列好，先看一眼");
    return {
      pipelineId: runId,
      projectId,
      waiting: true,
      step: "cast",
      title: bible.title,
      characterCount: bible.cast?.length ?? 0,
      eventCount: bible.events?.length ?? 0,
    };
  }

  const filled = await fillBibleFromCast({
    bible,
    story,
    projectId,
    llmEndpointId: payload.llmEndpointId,
    pack,
    substyle,
    continuing,
    episodeIndex: existingSeries ? existingSeries.episodeCount + 1 : 1,
  });
  return finishDramaCanvas({
    runId,
    projectId,
    directory,
    bible: filled,
    story,
    input,
    continuing,
    existingSeriesId: existingSeries?.id ?? null,
  });
};

function finishDramaCanvas(opts: {
  runId: string;
  projectId: string;
  directory: string;
  bible: DramaBible;
  story: string;
  input: {
    packId: string | null;
    substyle: string | null;
    seriesId: string | null;
    seriesName: string | null;
    kind: string;
    imageEndpointId: string | null;
  };
  continuing: boolean;
  existingSeriesId: string | null;
}) {
  const { runId, projectId, directory, bible, story, input, continuing, existingSeriesId } = opts;
  writeCanvas(projectId, directory, bible, input.imageEndpointId);

  let seriesId = existingSeriesId;
  let episodeIndex: number | null = null;
  if (seriesId) {
    episodeIndex = attachEpisode(seriesId, projectId, bible, JSON.stringify(bible.palette));
  } else if (input.seriesName?.trim()) {
    const created = createSeries({
      name: input.seriesName.trim(),
      kind: input.kind === "whiteboard" ? "whiteboard" : "drama",
      stylePackId: input.packId,
      substyle: input.substyle,
    });
    seriesId = created.id;
    episodeIndex = attachEpisode(seriesId, projectId, bible, JSON.stringify(bible.palette));
  }

  const t1 = now();
  db.run("UPDATE pipelines SET status = ?, currentStep = ?, stateJson = ?, updatedAt = ? WHERE id = ?", [
    "done",
    "canvas",
    JSON.stringify({ bible, story, seriesId, episodeIndex, input }),
    t1,
    runId,
  ]);
  return {
    pipelineId: runId,
    projectId,
    seriesId,
    episodeIndex,
    waiting: false,
    title: bible.title,
    episodeCount: bible.episodes.length,
    shotCount: bible.episodes.reduce((n, e) => n + e.shots.length, 0),
    message: continuing ? `第 ${episodeIndex} 集已搭好` : "5 集初稿已搭好",
  };
}

export async function advancePipeline(id: string): Promise<ReturnType<typeof finishDramaCanvas>> {
  const row = db.query("SELECT * FROM pipelines WHERE id = ?").get(id) as PipeRow | null;
  if (!row) throw new Error("流水线不存在");
  if (row.status !== "waiting") throw new Error("这一步不用确认，已经做完了");
  const project = db.query("SELECT directory FROM projects WHERE id = ?").get(row.projectId) as { directory: string } | null;
  if (!project) throw new Error("项目不存在");
  let state: { bible?: DramaBible; story?: string; input?: Parameters<typeof finishDramaCanvas>[0]["input"] & { llmEndpointId?: string | null } };
  try {
    state = JSON.parse(row.stateJson) as typeof state;
  } catch {
    throw new Error("流水线状态坏了，请重拆一集");
  }
  if (!state.bible) throw new Error("还没有人物档案");
  let bible = state.bible;
  const input = state.input ?? {
    packId: row.packId,
    substyle: state.bible.substyle,
    seriesId: null,
    seriesName: null,
    kind: "drama",
    imageEndpointId: null,
    llmEndpointId: null,
  };
  if (row.currentStep === "cast" || !bible.episodes.length) {
    const pack = input.packId ? loadPack(input.packId) : null;
    const series = input.seriesId ? getSeries(input.seriesId) : null;
    bible = await fillBibleFromCast({
      bible,
      story: state.story ?? "",
      projectId: row.projectId,
      llmEndpointId: input.llmEndpointId,
      pack,
      substyle: input.substyle,
      continuing: !!(series && series.episodeCount > 0),
      episodeIndex: series ? series.episodeCount + 1 : 1,
    });
    writeFileSync(join(project.directory, "pipeline/bible.json"), JSON.stringify(bible, null, 2));
  }
  return finishDramaCanvas({
    runId: id,
    projectId: row.projectId,
    directory: project.directory,
    bible,
    story: state.story ?? "",
    input,
    continuing: !!(input.seriesId && (getSeries(input.seriesId)?.episodeCount ?? 0) > 0),
    existingSeriesId: input.seriesId ?? null,
  });
}

function readWaitingState(id: string): {
  row: PipeRow;
  bible: DramaBible;
  story: string;
  input: Record<string, unknown>;
} {
  const row = db.query("SELECT * FROM pipelines WHERE id = ?").get(id) as PipeRow | null;
  if (!row) throw new Error("流水线不存在");
  if (row.status !== "waiting") throw new Error("现在不能改，先等这一步列完");
  let state: { bible?: DramaBible; story?: string; input?: Record<string, unknown> };
  try {
    state = JSON.parse(row.stateJson) as typeof state;
  } catch {
    throw new Error("流水线状态坏了");
  }
  if (!state.bible) throw new Error("还没有人物档案");
  return { row, bible: state.bible, story: state.story ?? "", input: state.input ?? {} };
}

function persistBible(row: PipeRow, bible: DramaBible, story: string, input: Record<string, unknown>) {
  const project = db.query("SELECT directory FROM projects WHERE id = ?").get(row.projectId) as { directory: string } | null;
  if (project) {
    mkdirSync(join(project.directory, "pipeline"), { recursive: true });
    writeFileSync(join(project.directory, "pipeline/bible.json"), JSON.stringify(bible, null, 2));
  }
  db.run("UPDATE pipelines SET stateJson = ?, updatedAt = ? WHERE id = ?", [
    JSON.stringify({ bible, story, input }),
    now(),
    row.id,
  ]);
}

export async function revisePipelineBible(id: string, instruction: string): Promise<DramaBible> {
  const { row, bible, story, input } = readWaitingState(id);
  const note = instruction.trim();
  if (!note) throw new Error("写一句你想怎么改整份，比如：全部改成中文");
  const endpoint = resolveEndpoint("llm", typeof input.llmEndpointId === "string" ? input.llmEndpointId : undefined);
  if (!endpoint) throw new Error("还没有文本模型，改整份要靠它");
  const adapter = getAdapter(endpoint.adapterType);
  if (!adapter?.chat) throw new Error("这个模型不会聊天");
  const text = await chatMetered(
    adapter,
    endpoint,
    { system: BIBLE_REVISE_SYSTEM, prompt: reviseBiblePrompt(bible, note) },
    { projectId: row.projectId, jobType: "pipeline.revise" },
  );
  const next = parseBibleRevise(text, bible);
  persistBible(row, next, story, input);
  return next;
}

export async function rewriteNovelStory(story: string, instruction: string): Promise<{ text: string; clipped: boolean }> {
  const note = instruction.trim();
  if (!note) throw new Error("写一句你想怎么改正文，比如：翻成中文");
  const clipped = clipNovel(story);
  const endpoint = resolveEndpoint("llm");
  if (!endpoint) throw new Error("改正文需要文本模型。先到「模型」页加一个。");
  const adapter = getAdapter(endpoint.adapterType);
  if (!adapter?.chat) throw new Error("这个模型不会聊天");
  const text = await chatMetered(
    adapter,
    endpoint,
    { system: STORY_REWRITE_SYSTEM, prompt: rewriteStoryPrompt(clipped.text, note) },
    { jobType: "pipeline.rewrite-story" },
  );
  const out = text.replace(/^```(?:\w+)?\s*|\s*```$/g, "").trim();
  if (out.length < 20) throw new Error("改完几乎是空的，换一句再说");
  return clipNovel(out);
}

export async function revisePipelineCast(
  id: string,
  body: {
    target: "character" | "event";
    targetId: string;
    instruction: string;
    images?: Array<{ mime: string; dataBase64: string }>;
  },
): Promise<DramaBible> {
  const { row, bible, story, input } = readWaitingState(id);
  const instruction = body.instruction.trim();
  if (!instruction && !(body.images && body.images.length)) throw new Error("写一句你想怎么改，或丢一张参考图");
  const endpoint = resolveEndpoint("llm", typeof input.llmEndpointId === "string" ? input.llmEndpointId : undefined);
  if (!endpoint) throw new Error("还没有文本模型，改角色要靠它");
  const adapter = getAdapter(endpoint.adapterType);
  if (!adapter?.chat) throw new Error("这个模型不会聊天");

  const images = (body.images ?? []).slice(0, 3).map((img) => ({
    mime: img.mime || "image/jpeg",
    data: Buffer.from(img.dataBase64.replace(/^data:[^;]+;base64,/, ""), "base64"),
  }));

  if (body.target === "character") {
    const cur = (bible.cast ?? []).find((c) => c.id === body.targetId);
    if (!cur) throw new Error("没找到这个角色");
    const text = await chatMetered(
      adapter,
      endpoint,
      {
        system: CAST_REVISE_SYSTEM,
        prompt: reviseCharacterPrompt(cur, instruction, images.length > 0),
        images,
      },
      { projectId: row.projectId, jobType: "pipeline.revise" },
    );
    let next = parseOneCharacter(text, cur);
    const painted = await paintCast(row.projectId, [next], typeof input.imageEndpointId === "string" ? input.imageEndpointId : undefined);
    next = painted[0] ?? next;
    bible.cast = (bible.cast ?? []).map((c) => (c.id === cur.id ? next : c));
    bible.assets = assetsFromCast(bible.cast, (bible.assets ?? []).filter((a) => a.kind !== "character"));
    persistBible(row, bible, story, input);
    return bible;
  }

  const cur = (bible.events ?? []).find((e) => e.id === body.targetId);
  if (!cur) throw new Error("没找到这条事件");
  const text = await chatMetered(
    adapter,
    endpoint,
    {
      system: EVENT_REVISE_SYSTEM,
      prompt: reviseEventPrompt(cur, instruction || "改写得更清楚"),
    },
    { projectId: row.projectId, jobType: "pipeline.revise" },
  );
  const next = parseOneEvent(text, cur);
  bible.events = (bible.events ?? []).map((e) => (e.id === cur.id ? next : e));
  persistBible(row, bible, story, input);
  return bible;
}

async function paintCast(
  projectId: string,
  cast: CharacterDossier[],
  imageEndpointId?: string | null,
): Promise<CharacterDossier[]> {
  return paintCastViews(projectId, cast, imageEndpointId);
}

async function fillBibleFromCast(opts: {
  bible: DramaBible;
  story: string;
  projectId: string;
  llmEndpointId?: string | null;
  pack: ReturnType<typeof loadPack>;
  substyle: string | null;
  continuing: boolean;
  episodeIndex: number;
}): Promise<DramaBible> {
  const endpoint = resolveEndpoint("llm", opts.llmEndpointId ?? undefined);
  if (!endpoint) throw new Error("往下拆集需要文本模型");
  const adapter = getAdapter(endpoint.adapterType);
  if (!adapter?.chat) throw new Error("这个模型不会聊天");
  const n = opts.continuing ? 1 : 5;
  let bible: DramaBible;
  try {
    const text = await chatMetered(
      adapter,
      endpoint,
      {
        system: opts.pack?.bibleSystem || CAST_TO_BIBLE_SYSTEM,
        prompt: bibleFromCastPrompt(opts.story, opts.bible, n),
      },
      { projectId: opts.projectId, jobType: "pipeline.bible" },
    );
    bible = parseDramaBible(text, opts.story, { episodeCount: n });
  } catch {
    bible = parseDramaBible("", opts.story, { episodeCount: n });
  }
  bible.title = opts.bible.title || bible.title;
  bible.palette = opts.bible.palette.colors.length ? opts.bible.palette : bible.palette;
  bible.cast = opts.bible.cast;
  bible.events = opts.bible.events;
  bible.assets = assetsFromCast(opts.bible.cast ?? [], (opts.bible.assets ?? []).filter((a) => a.kind !== "character"));
  if (opts.bible.assets.length && !bible.assets.some((a) => a.kind !== "character")) {
    bible.assets = [...bible.assets, ...opts.bible.assets.filter((a) => a.kind !== "character")];
  }
  bible.packId = opts.pack?.public.id ?? opts.bible.packId;
  bible.substyle = opts.substyle;
  if (opts.continuing) {
    bible.episodes = bible.episodes.map((e) => ({ ...e, index: opts.episodeIndex, title: e.title || `第 ${opts.episodeIndex} 集` }));
  }
  bible = stitchEpisodeFrames(bible);
  if (opts.pack) {
    let prevLast: string | null = null;
    bible = {
      ...bible,
      episodes: bible.episodes.map((ep) => {
        const shots = ep.shots.map((shot, i) => ({
          ...shot,
          imagePrompt: injectImagePrompt({
            pack: opts.pack!,
            raw: shot.imagePrompt || shot.visual,
            palette: bible.palette,
            substyle: opts.substyle,
            lastFrame: i === 0 ? prevLast : null,
          }),
        }));
        prevLast = ep.lastFrame || shots.at(-1)?.visual || prevLast;
        return { ...ep, shots };
      }),
    };
  }
  return finishBible({
    ...bible,
    bgmAssetId: opts.bible.bgmAssetId ?? null,
    ambienceAssetId: opts.bible.ambienceAssetId ?? null,
  });
}

export function bindPipelineEntity(
  id: string,
  opts: { entityId: string; assetId: string; view?: "face" | "front" | "side" | "full" },
): DramaBible {
  const row = db.query("SELECT * FROM pipelines WHERE id = ?").get(id) as PipeRow | null;
  if (!row) throw new Error("流水线不存在");
  let state: { bible?: DramaBible; story?: string; input?: Record<string, unknown> };
  try {
    state = JSON.parse(row.stateJson) as typeof state;
  } catch {
    throw new Error("流水线状态坏了");
  }
  if (!state.bible) throw new Error("还没有人物档案");
  const bible = state.bible;
  const view = opts.view ?? "front";
  const nextCast = (bible.cast ?? []).map((c) => {
    if (c.id !== opts.entityId) return c;
    const views = [...(c.views ?? []).filter((v) => v.kind !== view), { kind: view, assetId: opts.assetId }];
    return { ...c, libraryAssetId: opts.assetId, imageAssetId: opts.assetId, views };
  });
  const nextAssets = (bible.assets ?? []).map((a) => {
    if (a.id !== opts.entityId) return a;
    const views = [...(a.views ?? []).filter((v) => v.kind !== view), { kind: view, assetId: opts.assetId }];
    return { ...a, libraryAssetId: opts.assetId, imageAssetId: opts.assetId, views };
  });
  const next = { ...bible, cast: nextCast, assets: nextAssets };
  persistBible(row, next, state.story ?? "", state.input ?? {});
  return next;
}

export function retryPipelineBible(id: string) {
  const row = db.query("SELECT * FROM pipelines WHERE id = ?").get(id) as PipeRow | null;
  if (!row) throw new Error("流水线不存在");
  let state: { story?: string; input?: Record<string, unknown> };
  try {
    state = JSON.parse(row.stateJson) as typeof state;
  } catch {
    state = {};
  }
  const story = typeof state.story === "string" ? state.story : "";
  if (!story) throw new Error("找不到原文，请回到小说页重来");
  const input = state.input ?? {};
  db.run("UPDATE pipelines SET status = ?, updatedAt = ? WHERE id = ?", ["canceled", now(), id]);
  return jobQueue.submit(
    "pipeline.run",
    {
      story,
      projectId: row.projectId,
      packId: input.packId ?? row.packId,
      substyle: input.substyle,
      seriesId: input.seriesId,
      seriesName: input.seriesName,
      kind: input.kind ?? "drama",
      llmEndpointId: input.llmEndpointId,
      imageEndpointId: input.imageEndpointId,
      checkpoint: true,
    },
    row.projectId,
  );
}

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
