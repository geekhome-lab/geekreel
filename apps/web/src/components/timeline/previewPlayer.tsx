import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { clipDuration, subtitleTrack, type Asset, type TimelineDoc } from "@vw/core";
import { api } from "../../lib/api";

/**
 * 预览：播放头是时钟，视频/静帧跟着走。
 * 有配音轨时播配音、静掉原片声。
 */
export function PreviewPlayer(props: {
  doc: TimelineDoc;
  playheadMs: number;
  playing: boolean;
  totalMs: number;
  onSeekTimeline: (ms: number) => void;
  onPause: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const playheadRef = useRef(props.playheadMs);
  playheadRef.current = props.playheadMs;
  const { doc, playheadMs, playing } = props;

  const vClips = useMemo(() => {
    const t = doc.tracks.find((t) => t.type === "video");
    return [...(t?.clips ?? [])].sort((a, b) => a.startMs - b.startMs);
  }, [doc]);

  const aClips = useMemo(() => {
    return doc.tracks
      .filter((t) => t.type === "audio")
      .flatMap((t) => t.clips)
      .filter((c) => c.assetId)
      .sort((a, b) => a.startMs - b.startMs);
  }, [doc]);

  const active = useMemo(() => {
    return vClips.find((c) => playheadMs >= c.startMs && playheadMs < c.startMs + clipDuration(c)) ?? null;
  }, [vClips, playheadMs]);

  const activeAudio = useMemo(() => {
    return aClips.find((c) => playheadMs >= c.startMs && playheadMs < c.startMs + clipDuration(c)) ?? null;
  }, [aClips, playheadMs]);

  const { data: asset } = useQuery({
    queryKey: ["asset", active?.assetId],
    queryFn: () => api<Asset>(`/api/assets/${active!.assetId}`),
    enabled: !!active?.assetId,
  });
  const { data: audioAsset } = useQuery({
    queryKey: ["asset", activeAudio?.assetId],
    queryFn: () => api<Asset>(`/api/assets/${activeAudio!.assetId}`),
    enabled: !!activeAudio?.assetId,
  });

  const isStill = asset?.type === "image";
  const srcMs = active ? active.inMs + Math.max(0, playheadMs - active.startMs) : 0;
  const audioSrcMs = activeAudio ? activeAudio.inMs + Math.max(0, playheadMs - activeAudio.startMs) : 0;
  const hasDub = aClips.length > 0;

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const next = playheadRef.current + (now - last);
      last = now;
      if (next >= props.totalMs) {
        props.onSeekTimeline(props.totalMs);
        props.onPause();
        return;
      }
      props.onSeekTimeline(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, props.totalMs]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !active || !asset || isStill) return;
    const url = `/api/assets/${asset.id}/file?variant=${asset.proxyPath ? "proxy" : "original"}`;
    if (v.dataset.src !== url) {
      v.dataset.src = url;
      v.src = url;
    }
    v.muted = hasDub || (active.volume ?? 1) === 0;
    const target = srcMs / 1000;
    if (Math.abs(v.currentTime - target) > 0.2) v.currentTime = target;
    if (playing) void v.play().catch(() => {});
    else v.pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, asset?.id, isStill, playing, hasDub]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !active || playing || isStill) return;
    const target = srcMs / 1000;
    if (Math.abs(v.currentTime - target) > 0.15) v.currentTime = target;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playheadMs, playing, isStill]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (!activeAudio || !audioAsset) {
      a.pause();
      a.removeAttribute("src");
      delete a.dataset.src;
      return;
    }
    const url = `/api/assets/${audioAsset.id}/file`;
    if (a.dataset.src !== url) {
      a.dataset.src = url;
      a.src = url;
    }
    const target = audioSrcMs / 1000;
    if (Math.abs(a.currentTime - target) > 0.2) a.currentTime = target;
    if (playing) void a.play().catch(() => {});
    else a.pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAudio?.id, audioAsset?.id, playing]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a || !activeAudio || playing) return;
    const target = audioSrcMs / 1000;
    if (Math.abs(a.currentTime - target) > 0.15) a.currentTime = target;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playheadMs, playing]);

  const subText = useMemo(() => {
    const track = subtitleTrack(doc);
    const cue = track?.clips.find(
      (c) => c.text?.trim() && playheadMs >= c.startMs && playheadMs < c.startMs + clipDuration(c),
    );
    return cue?.text ?? "";
  }, [doc, playheadMs]);

  const fileUrl = asset
    ? `/api/assets/${asset.id}/file?variant=${asset.thumbPath && isStill ? "original" : asset.proxyPath ? "proxy" : "original"}`
    : "";

  return (
    <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl border border-line bg-black">
      {active && asset && isStill && (
        <img className="h-full w-full object-contain" src={fileUrl} alt={asset.title} />
      )}
      {active && asset && !isStill && (
        <video ref={videoRef} className="h-full w-full object-contain" muted={hasDub} />
      )}
      <audio ref={audioRef} className="hidden" />
      {!active && vClips.length === 0 && (
        <div className="text-xs text-fg-faint">时间线为空 —— 出片后会自动装上，也可点「添加素材」</div>
      )}
      {subText && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[7%] flex justify-center px-10">
          <span className="max-w-[13em] whitespace-pre-wrap text-center text-[12px] font-normal leading-[1.45] tracking-[0.06em] text-[#f4f1ea] [text-shadow:0_1px_1px_rgba(20,10,6,.75),0_0_10px_rgba(20,10,6,.28)]">
            {subText}
          </span>
        </div>
      )}
    </div>
  );
}
