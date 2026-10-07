import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { emptyTimelineDoc, extFromFileName, extFromMime, layBgm, mimeFromExt, type DramaBible, type DramaShot } from "@vw/core";
import { detectBins, probe, videoThumbnail } from "@vw/media";
import { getAdapter } from "@vw/models";
import { lockProductionIntoPrompt, pickShotRefImages, primaryEntityImage, shotDurationSec } from "@vw/pipeline";
import { db } from "../db";
import type { JobHandler } from "../jobs/queue";
import { now } from "../lib/resp";
import { speakOne } from "./dub";
import { absInLibrary, storeAsset } from "./library";
import { resolveEndpoint } from "./models";
import { recordUsage } from "./usage";

function loadBible(projectId: string): { bible: DramaBible; directory: string } {
  const row = db.query("SELECT directory FROM projects WHERE id = ?").get(projectId) as { directory: string } | null;
  if (!row) throw new Error("项目不存在");
  const path = join(row.directory, "pipeline", "bible.json");
  if (!existsSync(path)) throw new Error("这部还没有分镜。先到小说转短剧确认人物，再往下走。");
  const bible = JSON.parse(readFileSync(path, "utf8")) as DramaBible;
  return { bible, directory: row.directory };
}

function saveBible(directory: string, bible: DramaBible) {
  mkdirSync(join(directory, "pipeline"), { recursive: true });
  writeFileSync(join(directory, "pipeline", "bible.json"), JSON.stringify(bible, null, 2));
}

function imageBytes(assetId: string | null | undefined): { mime: string; data: Uint8Array } | undefined {
  if (!assetId) return undefined;
  const row = db.query("SELECT path FROM assets WHERE id = ? AND type = 'image'").get(assetId) as { path: string } | null;
  if (!row) return undefined;
  return { mime: mimeFromExt(extFromFileName(row.path) || "png"), data: new Uint8Array(readFileSync(absInLibrary(row.path))) };
}

function audioBytes(assetId: string | null | undefined): { mime: string; data: Uint8Array } | undefined {
  if (!assetId) return undefined;
  const row = db.query("SELECT path FROM assets WHERE id = ? AND type = 'audio'").get(assetId) as { path: string } | null;
  if (!row) return undefined;
  return { mime: mimeFromExt(extFromFileName(row.path) || "mp3"), data: new Uint8Array(readFileSync(absInLibrary(row.path))) };
}

export const renderEpisodeHandler: JobHandler = async (job, ctx) => {
  const payload = JSON.parse(job.payloadJson) as {
    projectId?: string;
    episodeIndex?: number;
    videoEndpointId?: string;
    imageEndpointId?: string;
    ttsEndpointId?: string;
    withSubtitles?: boolean;
  };
  const projectId = payload.projectId ?? job.projectId;
  if (!projectId) throw new Error("缺少项目");

  const { bible, directory } = loadBible(projectId);
  const ep =
    bible.episodes.find((e) => e.index === payload.episodeIndex) ??
    bible.episodes[bible.episodes.length - 1] ??
    null;
  if (!ep || ep.shots.length === 0) throw new Error("这一集还没有分镜。先确认人物再往下走。");

  const imageEp = resolveEndpoint("image", payload.imageEndpointId);
  const videoEp = resolveEndpoint("video", payload.videoEndpointId);
  const ttsEp = resolveEndpoint("tts", payload.ttsEndpointId);
  const imageAd = imageEp ? getAdapter(imageEp.adapterType) : null;
  const videoAd = videoEp ? getAdapter(videoEp.adapterType) : null;
  if (!imageAd?.generateImage && !videoAd?.generateVideo) {
    throw new Error("出集至少要有图片或视频模型。到「模型」页加上再来。");
  }

  const bins = await detectBins();
  const doc = emptyTimelineDoc({ portrait: true });
  const vTrack = doc.tracks.find((t) => t.type === "video")!;
  const aTrack = doc.tracks.find((t) => t.type === "audio")!;
  const sTrack = doc.tracks.find((t) => t.type === "subtitle")!;

  let cursor = 0;
  let lastFrameId: string | null = null;
  let lastFrameDesc = "";
  let lipsMissed = 0;
  const shots: DramaShot[] = [];

  for (let i = 0; i < ep.shots.length; i++) {
    const shot = ep.shots[i]!;
    const durSec = shotDurationSec(shot);
    const durMs = durSec * 1000;
    ctx.progress(0.08 + (i / ep.shots.length) * 0.8, `第 ${i + 1}/${ep.shots.length} 镜`);

    const prompt = lockProductionIntoPrompt({
      prompt: shot.imagePrompt || shot.visual,
      bible,
      entityIds: shot.entityIds,
      lastFrame: lastFrameDesc || null,
      dialogue: shot.line || null,
    });
    const refIds = pickShotRefImages(bible, shot.entityIds, lastFrameId ? [lastFrameId] : []);
    const faceId =
      (bible.cast ?? [])
        .filter((c) => !shot.entityIds?.length || shot.entityIds.includes(c.id))
        .map((c) => primaryEntityImage(c))
        .find(Boolean) ?? refIds[0];
    const startImage = imageBytes(faceId) ?? imageBytes(lastFrameId) ?? imageBytes(refIds[0]);

    let imageAssetId: string | null = lastFrameId ?? refIds[0] ?? null;
    let videoAssetId: string | null = null;
    let audioAssetId: string | null = null;
    let lipSynced = false;
    let lipsNote: string | null = null;

    if (!imageAssetId && imageAd?.generateImage && imageEp) {
      try {
        const still = await imageAd.generateImage(imageEp.config, {
          prompt,
          size: "1024x1536",
          signal: ctx.signal,
        });
        const asset = storeAsset({
          type: "image",
          title: `${bible.title} E${ep.index}-${i + 1}`,
          ext: extFromMime(still.mime, "png"),
          source: "pipeline",
          projectId,
          data: still.data,
        });
        recordUsage({ endpoint: imageEp, projectId, jobType: "pipeline.episode", images: 1 });
        imageAssetId = asset.id;
      } catch {
        /* 没静帧也能试视频 */
      }
    }

    if (videoAd?.generateVideo && videoEp) {
      try {
        const result = await videoAd.generateVideo(videoEp.config, {
          prompt,
          durationSec: durSec,
          signal: ctx.signal,
          image: startImage ?? imageBytes(imageAssetId),
          lastFrame: lastFrameId ? imageBytes(lastFrameId) : undefined,
          dialogue: shot.line || undefined,
          audio: Boolean(shot.line),
        });
        const asset = storeAsset({
          type: "video",
          title: `${bible.title} E${ep.index}-${i + 1}镜`,
          ext: extFromMime(result.mime, "mp4"),
          source: "pipeline",
          projectId,
          data: result.data,
        });
        recordUsage({
          endpoint: videoEp,
          projectId,
          jobType: "pipeline.episode",
          videoSec: result.durationSec ?? durSec,
        });
        videoAssetId = asset.id;
        if (bins.ffmpeg && bins.ffprobe) {
          const abs = absInLibrary(asset.path);
          const info = await probe(bins.ffprobe, abs);
          const at = Math.max(200, (info?.durationMs ?? durMs) - 240);
          const tmp = join(directory, "pipeline", `tail-${ep.index}-${i}.jpg`);
          await videoThumbnail(bins.ffmpeg, abs, tmp, at, ctx.signal);
          if (existsSync(tmp)) {
            const tail = storeAsset({
              type: "image",
              title: `${bible.title} E${ep.index}-${i + 1}尾帧`,
              ext: "jpg",
              source: "pipeline",
              projectId,
              fromPath: tmp,
            });
            lastFrameId = tail.id;
          }
        }
      } catch {
        videoAssetId = null;
        lipSynced = false;
      }
    }

    if (shot.line.trim()) {
      const spoken = await speakOne(shot.line, { projectId, endpoint: ttsEp, signal: ctx.signal });
      if (spoken) audioAssetId = spoken.assetId;
    }

    if (shot.line.trim() && audioAssetId && (videoAd?.lipSync || videoAd?.generateVideo) && videoEp) {
      const still = imageBytes(imageAssetId) ?? startImage;
      const voice = audioBytes(audioAssetId);
      if (still && voice) {
        try {
          ctx.progress(0.08 + ((i + 0.7) / ep.shots.length) * 0.8, `第 ${i + 1} 镜对口型`);
          const lip = videoAd.lipSync
            ? await videoAd.lipSync(videoEp.config, {
                image: still,
                audio: voice,
                text: shot.line,
                durationSec: durSec,
                signal: ctx.signal,
              })
            : await videoAd.generateVideo!(videoEp.config, {
                prompt: `${prompt}\n这是对口型那一道：嘴必须对上台词。`,
                durationSec: durSec,
                image: still,
                dialogue: shot.line,
                audio: true,
                voice,
                signal: ctx.signal,
              });
          const asset = storeAsset({
            type: "video",
            title: `${bible.title} E${ep.index}-${i + 1}对口型`,
            ext: extFromMime(lip.mime, "mp4"),
            source: "pipeline",
            projectId,
            data: lip.data,
          });
          recordUsage({
            endpoint: videoEp,
            projectId,
            jobType: "pipeline.lipsync",
            videoSec: lip.durationSec ?? durSec,
          });
          videoAssetId = asset.id;
          lipSynced = true;
          lipsNote = null;
        } catch (e) {
          lipsMissed += 1;
          const reason = e instanceof Error ? e.message : String(e);
          lipsNote = videoAssetId
            ? `对口型没对上：${reason}。成片仍用原视频，没有改成静帧。`
            : `对口型没对上：${reason}。只有定妆图，嘴没动。`;
        }
      } else {
        lipsMissed += 1;
        lipsNote = videoAssetId
          ? "对口型缺定妆或配音，原视频没改成静帧。"
          : "有台词但缺定妆或配音，嘴没动。";
      }
    } else if (shot.line.trim() && !lipSynced) {
      lipsMissed += 1;
      lipsNote = videoAssetId
        ? "有台词。视频模型不会对口型，原视频保留，配音另铺。"
        : "有台词但对口型没跑成。没有用静帧冒充说话。";
    }

    if (!videoAssetId && !imageAssetId) {
      throw new Error(`第 ${i + 1} 镜没出成。检查图片或视频模型，再点出这一集。`);
    }

    const visualId = videoAssetId ?? imageAssetId!;
    vTrack.clips.push({
      id: `c_v_${i}`,
      assetId: visualId,
      startMs: cursor,
      inMs: 0,
      outMs: durMs,
      volume: 1,
    });
    if (audioAssetId) {
      aTrack.clips.push({
        id: `c_a_${i}`,
        assetId: audioAssetId,
        startMs: cursor,
        inMs: 0,
        outMs: durMs,
        volume: 1,
      });
      const lastV = vTrack.clips.at(-1);
      if (lastV) lastV.volume = 0;
    }
    if (shot.line.trim() && payload.withSubtitles !== false) {
      sTrack.clips.push({
        id: `c_s_${i}`,
        text: shot.line.trim(),
        startMs: cursor,
        inMs: 0,
        outMs: durMs,
        volume: 1,
      });
    }

    lastFrameDesc = shot.visual || shot.imagePrompt || lastFrameDesc;
    if (!videoAssetId && imageAssetId) lastFrameId = imageAssetId;
    shots.push({
      ...shot,
      imageAssetId,
      videoAssetId,
      audioAssetId,
      lipSynced,
      lipsNote,
    });
    cursor += durMs;
  }

  const nextBible: DramaBible = {
    ...bible,
    episodes: bible.episodes.map((e) => (e.index === ep.index ? { ...e, shots, lastFrame: lastFrameDesc } : e)),
  };
  saveBible(directory, nextBible);
  const pipe = db
    .query("SELECT id, stateJson FROM pipelines WHERE projectId = ? ORDER BY updatedAt DESC LIMIT 1")
    .get(projectId) as { id: string; stateJson: string } | null;
  if (pipe) {
    try {
      const st = JSON.parse(pipe.stateJson) as { bible?: DramaBible };
      st.bible = nextBible;
      db.run("UPDATE pipelines SET stateJson = ?, updatedAt = ? WHERE id = ?", [
        JSON.stringify(st),
        now(),
        pipe.id,
      ]);
    } catch {
      /* bible file already saved */
    }
  }
  const proj = db.query("SELECT seriesId FROM projects WHERE id = ?").get(projectId) as { seriesId: string | null } | null;
  if (proj?.seriesId) {
    db.run("UPDATE series SET bibleJson = ?, lastProjectId = ?, updatedAt = ? WHERE id = ?", [
      JSON.stringify(nextBible),
      projectId,
      now(),
      proj.seriesId,
    ]);
  }
  const withMusic = bible.bgmAssetId ? layBgm(doc, bible.bgmAssetId) : doc;
  mkdirSync(join(directory, "timeline"), { recursive: true });
  writeFileSync(join(directory, "timeline", "main.json"), JSON.stringify(withMusic, null, 2));

  ctx.progress(
    1,
    lipsMissed
      ? `${lipsMissed} 镜对口型没过，原视频还在，没有改成静帧`
      : bible.bgmAssetId
        ? "这一集已装上时间线，对口型和配乐都铺了"
        : "这一集已装上时间线，对口型过了",
  );
  return {
    projectId,
    episodeIndex: ep.index,
    shotCount: shots.length,
    lipsMissed,
    portrait: true,
  };
};
