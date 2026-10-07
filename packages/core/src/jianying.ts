/**
 * 剪映 / CapCut 草稿：时间线映射成 draft_content + draft_meta_info。
 * 时间单位是微秒。媒体路径由调用方写成拷进草稿夹后的绝对路径。
 */

import { clipDuration, timelineDuration, type TimelineDoc } from "./timeline";

export interface JianyingMedia {
  assetId: string;
  path: string;
  title: string;
  type: "video" | "image" | "audio";
  durationMs: number;
  width?: number;
  height?: number;
}

export interface JianyingDraftFiles {
  draftContent: Record<string, unknown>;
  draftMeta: Record<string, unknown>;
}

function uid(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

function us(ms: number): number {
  return Math.max(0, Math.round(ms * 1000));
}

export function buildJianyingDraft(opts: {
  name: string;
  doc: TimelineDoc;
  media: JianyingMedia[];
  createdAt?: number;
}): JianyingDraftFiles {
  const now = opts.createdAt ?? Date.now();
  const durationUs = us(Math.max(timelineDuration(opts.doc), 1000));
  const byId = new Map(opts.media.map((m) => [m.assetId, m]));
  const draftId = uid();

  const videos: Record<string, unknown>[] = [];
  const audios: Record<string, unknown>[] = [];
  const texts: Record<string, unknown>[] = [];
  const speeds: Record<string, unknown>[] = [];
  const canvases: Record<string, unknown>[] = [];
  const mappings: Record<string, unknown>[] = [];
  const tracks: Record<string, unknown>[] = [];

  for (const track of opts.doc.tracks) {
    const segments: Record<string, unknown>[] = [];
    for (const clip of track.clips) {
      const dur = clipDuration(clip);
      if (dur <= 0) continue;
      const speedId = uid();
      const canvasId = uid();
      const mapId = uid();
      speeds.push({ id: speedId, speed: clip.speed && clip.speed > 0 ? clip.speed : 1, type: "speed", mode: 0 });
      canvases.push({ id: canvasId, type: "canvas_color", color: "", image: "", blur: 0, album_image: "" });
      mappings.push({ id: mapId, audio_channel_mapping: 0, is_config_open: false, type: "" });

      if (track.type === "subtitle") {
        const textId = uid();
        texts.push({
          id: textId,
          type: "subtitle",
          content: clip.text?.trim() || "",
          font_size: 8,
          font_path: "",
          text_color: "#F4F1EA",
          alignment: 1,
        });
        segments.push({
          id: uid(),
          material_id: textId,
          target_timerange: { start: us(clip.startMs), duration: us(dur) },
          source_timerange: { start: 0, duration: us(dur) },
          extra_material_refs: [speedId],
        });
        continue;
      }

      const media = clip.assetId ? byId.get(clip.assetId) : undefined;
      if (!media) continue;
      const materialId = uid();
      const isAudio = track.type === "audio" || media.type === "audio";
      const entry = {
        id: materialId,
        path: media.path,
        name: media.title,
        type: media.type === "image" ? "photo" : isAudio ? "extract_music" : "video",
        duration: us(media.durationMs || dur),
        width: media.width ?? opts.doc.width,
        height: media.height ?? opts.doc.height,
      };
      if (isAudio) audios.push(entry);
      else videos.push(entry);
      segments.push({
        id: uid(),
        material_id: materialId,
        target_timerange: { start: us(clip.startMs), duration: us(dur) },
        source_timerange: { start: us(clip.inMs), duration: us(clip.outMs - clip.inMs) },
        speed: clip.speed && clip.speed > 0 ? clip.speed : 1,
        volume: clip.volume ?? 1,
        extra_material_refs: [speedId, canvasId, mapId],
      });
    }
    if (!segments.length) continue;
    tracks.push({
      id: uid(),
      type: track.type === "subtitle" ? "text" : track.type,
      attribute: 0,
      flag: 0,
      segments,
    });
  }

  const draftContent = {
    id: draftId,
    new_version: "110.0.0",
    fps: 30,
    duration: durationUs,
    canvas_config: {
      width: opts.doc.width,
      height: opts.doc.height,
      ratio: opts.doc.height > opts.doc.width ? "9:16" : "16:9",
    },
    platform: {
      os: "mac",
      app_id: 3704,
      app_source: "lv",
      app_version: "5.9.0",
      os_version: "15.0",
    },
    materials: {
      videos,
      audios,
      texts,
      speeds,
      canvases,
      sound_channel_mappings: mappings,
      drafts: [],
      material_animations: [],
      effects: [],
      images: [],
      stickers: [],
    },
    tracks,
    color_space: 0,
    last_modified_platform: {
      os: "mac",
      app_id: 3704,
      app_source: "lv",
      app_version: "5.9.0",
    },
  };

  const draftMeta = {
    draft_id: draftId,
    draft_name: opts.name,
    draft_cover: "",
    draft_fold_path: "",
    draft_root_path: "",
    tm_draft_create: now * 1000,
    tm_draft_modified: now * 1000,
    tm_duration: durationUs,
    tm_draft_cloud_completed: "",
  };

  return { draftContent, draftMeta };
}
