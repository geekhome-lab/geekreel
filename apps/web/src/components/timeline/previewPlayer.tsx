import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { clipDuration, subtitleTrack, type Asset, type TimelineDoc } from "@vw/core";
import { api } from "../../lib/api";

/**
 * 预览：播放头是时钟，视频/静帧跟着走。
 * 音频轨不参与预览（导出时生效）。
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
  const playheadRef = useRef(props.playheadMs);
  playheadRef.current = props.playheadMs;
  const { doc, playheadMs, playing } = props;

  const vClips = useMemo(() => {
    const t = doc.tracks.find((t) => t.type === "video");
    return [...(t?.clips ?? [])].sort((a, b) => a.startMs - b.startMs);
  }, [doc]);

  const active = useMemo(() => {
    return vClips.find((c) => playheadMs >= c.startMs && playheadMs < c.startMs + clipDuration(c)) ?? null;
  }, [vClips, playheadMs]);

  const { data: asset } = useQuery({
    queryKey: ["asset", active?.assetId],
    queryFn: () => api<Asset>(`/api/assets/${active!.assetId}`),
    enabled: !!active?.assetId,
  });

  const isStill = asset?.type === "image";
  const srcMs = active ? active.inMs + Math.max(0, playheadMs - active.startMs) : 0;

  // 播放时钟：统一推进播放头（静帧/空隙也走）
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

  // 切到视频片段 → 换源并 seek
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !active || !asset || isStill) return;
    const url = `/api/assets/${asset.id}/file?variant=${asset.proxyPath ? "proxy" : "original"}`;
    if (v.dataset.src !== url) {
      v.dataset.src = url;
      v.src = url;
    }
    const target = srcMs / 1000;
    if (Math.abs(v.currentTime - target) > 0.2) v.currentTime = target;
    if (playing) void v.play().catch(() => {});
    else v.pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, asset?.id, isStill, playing]);

  // 暂停时拖动播放头 → 视频 seek
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !active || playing || isStill) return;
    const target = srcMs / 1000;
    if (Math.abs(v.currentTime - target) > 0.15) v.currentTime = target;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playheadMs, playing, isStill]);

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
        <video ref={videoRef} className="h-full w-full object-contain" muted={false} />
      )}
      {!active && vClips.length === 0 && (
        <div className="text-xs text-fg-faint">时间线为空 —— 从画布装上，或点「添加素材」</div>
      )}
      {subText && (
        <div className="absolute bottom-4 left-0 right-0 text-center">
          <span className="rounded bg-black/70 px-3 py-1 text-sm text-white">{subText}</span>
        </div>
      )}
    </div>
  );
}
