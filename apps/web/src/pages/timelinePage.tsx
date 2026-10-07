import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  clipDuration,
  msToSrtTime,
  parseSrt,
  timelineDuration,
  type Asset,
  type Job,
  type PipelineRun,
  type TimelineClip,
  type TimelineDoc,
  type TimelineTrack,
} from "@vw/core";
import { api, apiJson } from "../lib/api";
import { useAppStore } from "../lib/store";
import { submitRender, submitTimelineFinish, waitForJob } from "../lib/runGen";
import { usePrefs } from "../lib/prefs";
import { iconPlus, iconUpload } from "../lib/icons";
import { Modal } from "../components/modal";
import { AssetPickerModal } from "../components/canvas/assetPickerModal";
import { PreviewPlayer } from "../components/timeline/previewPlayer";
import { VoicePicker } from "../components/timeline/voicePicker";

function newClipId() {
  return `c${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function fmtMs(ms: number): string {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}.${String(Math.floor((s % 1) * 10))}`;
}

export function TimelinePage() {
  const currentProjectId = useAppStore((s) => s.currentProjectId);
  const navigate = useNavigate();
  if (!currentProjectId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-fg-faint">
        <p className="text-sm">请先在「项目」页选择或创建一个项目</p>
        <button
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-black hover:brightness-110"
          onClick={() => navigate("/projects")}
        >
          去项目页
        </button>
      </div>
    );
  }
  return <TimelineEditor projectId={currentProjectId} />;
}

function TimelineEditor({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [doc, setDoc] = useState<TimelineDoc | null>(null);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pps, setPps] = useState(50); // 缩放：像素/秒
  const [selected, setSelected] = useState<string | null>(null); // clipId
  const [picking, setPicking] = useState(false);
  const [pickingBgm, setPickingBgm] = useState(false);
  const [draftHint, setDraftHint] = useState("");
  const [editingSub, setEditingSub] = useState<string | null>(null);
  const [exportJob, setExportJob] = useState<{ id: string; status: string; assetId?: string; error?: string } | null>(null);
  const [ttsBusy, setTtsBusy] = useState(false);
  const [ttsError, setTtsError] = useState("");
  const autoSubtitles = usePrefs((s) => s.autoSubtitles);
  const patchPrefs = usePrefs((s) => s.patch);
  const [burnSubs, setBurnSubs] = useState(() => usePrefs.getState().autoSubtitles);
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving">("saved");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const srtInput = useRef<HTMLInputElement>(null);

  // 加载
  useEffect(() => {
    setDoc(null);
    api<{ doc: TimelineDoc }>(`/api/timeline/project/${projectId}`).then((r) => setDoc(r.doc));
  }, [projectId]);

  // 资产信息（裁剪上限需要时长）
  const { data: allAssets } = useQuery({
    queryKey: ["assets"],
    queryFn: () => api<Asset[]>("/api/assets"),
  });
  const { data: pipes } = useQuery({
    queryKey: ["pipelines", projectId],
    queryFn: () => api<PipelineRun[]>(`/api/pipelines?projectId=${encodeURIComponent(projectId)}`),
  });
  const lipsNotes = (pipes?.[0]?.bible?.episodes ?? []).flatMap((e) => e.shots).filter((s) => s.lipsNote);
  const assetMap = useMemo(() => new Map((allAssets ?? []).map((a) => [a.id, a])), [allAssets]);

  const scheduleSave = useCallback(
    (next: TimelineDoc) => {
      setSaveState("dirty");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        setSaveState("saving");
        try {
          await apiJson(`/api/timeline/project/${projectId}`, "put", { doc: next });
          setSaveState("saved");
        } catch {
          setSaveState("dirty");
        }
      }, 800);
    },
    [projectId],
  );

  const update = useCallback(
    (fn: (doc: TimelineDoc) => TimelineDoc) => {
      setDoc((d) => {
        if (!d) return d;
        const next = fn(structuredClone(d));
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave],
  );

  const contentMs = doc ? timelineDuration(doc) : 0;
  const totalMs = Math.max(contentMs, 5000);
  const msToPx = (ms: number) => (ms / 1000) * pps;

  // ---------------------------------------------------------------------------
  // 片段操作
  // ---------------------------------------------------------------------------

  const addAssetClip = (asset: Asset) => {
    if (asset.type === "text") return;
    update((d) => {
      const trackType = asset.type === "audio" ? "audio" : "video";
      let track = d.tracks.find((t) => t.type === trackType);
      if (!track) {
        track = { id: `t_${newClipId()}`, type: trackType, name: trackType === "video" ? "视频" : "音频", clips: [] };
        d.tracks.push(track);
      }
      const end = track.clips.reduce((m, c) => Math.max(m, c.startMs + clipDuration(c)), 0);
      const dur = asset.type === "image" ? 3000 : (asset.durationMs ?? 3000);
      track.clips.push({
        id: newClipId(),
        assetId: asset.id,
        startMs: end,
        inMs: 0,
        outMs: dur,
        volume: 1,
      });
      return d;
    });
  };

  const [assembling, setAssembling] = useState(false);
  const fromCanvas = async () => {
    setAssembling(true);
    try {
      const job = await submitTimelineFinish(projectId, { withSubtitles: autoSubtitles, dub: false });
      const done = await waitForJob(job.id, 15 * 60_000);
      if (done.status === "failed") throw new Error(done.error || "装配失败");
      const r = await api<{ doc: TimelineDoc }>(`/api/timeline/project/${projectId}`);
      setDoc(r.doc);
      setSaveState("saved");
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    } catch (e) {
      setExportJob({ id: "", status: "failed", error: e instanceof Error ? e.message : String(e) });
    } finally {
      setAssembling(false);
    }
  };

  const deleteSelected = () => {
    if (!selected) return;
    update((d) => {
      for (const t of d.tracks) t.clips = t.clips.filter((c) => c.id !== selected);
      return d;
    });
    setSelected(null);
  };

  const splitAtPlayhead = () => {
    if (!doc) return;
    update((d) => {
      for (const t of d.tracks) {
        if (t.type === "subtitle") continue;
        const idx = t.clips.findIndex(
          (c) => playheadMs > c.startMs && playheadMs < c.startMs + clipDuration(c),
        );
        if (idx < 0) continue;
        const c = t.clips[idx]!;
        const cutOffset = playheadMs - c.startMs;
        const second: TimelineClip = {
          ...c,
          id: newClipId(),
          startMs: playheadMs,
          inMs: c.inMs + cutOffset,
        };
        t.clips[idx] = { ...c, outMs: c.inMs + cutOffset };
        t.clips.splice(idx + 1, 0, second);
        break; // 只切最上面命中的轨
      }
      return d;
    });
  };

  const importSrt = async (file: File) => {
    const text = await file.text();
    const cues = parseSrt(text);
    if (cues.length === 0) return;
    update((d) => {
      let track = d.tracks.find((t) => t.type === "subtitle");
      if (!track) {
        track = { id: "s1", type: "subtitle", name: "字幕", clips: [] };
        d.tracks.push(track);
      }
      track.clips = cues.map((c) => ({
        id: newClipId(),
        text: c.text,
        startMs: c.startMs,
        inMs: 0,
        outMs: c.endMs - c.startMs,
        volume: 1,
      }));
      return d;
    });
  };

  const addSubtitle = () => {
    const id = newClipId();
    update((d) => {
      let track = d.tracks.find((t) => t.type === "subtitle");
      if (!track) {
        track = { id: "s1", type: "subtitle", name: "字幕", clips: [] };
        d.tracks.push(track);
      }
      track.clips.push({ id, text: "新字幕", startMs: playheadMs, inMs: 0, outMs: 2000, volume: 1 });
      return d;
    });
    setEditingSub(id);
  };

  // ---------------------------------------------------------------------------
  // 拖拽（移动 / 左右裁剪）
  // ---------------------------------------------------------------------------

  const startDrag = (e: React.PointerEvent, trackId: string, clipId: string, mode: "move" | "trim-l" | "trim-r") => {
    e.stopPropagation();
    e.preventDefault();
    setSelected(clipId);
    const startX = e.clientX;
    const track = doc?.tracks.find((t) => t.id === trackId);
    const clip = track?.clips.find((c) => c.id === clipId);
    if (!track || !clip) return;
    const orig = { ...clip };
    const asset = clip.assetId ? assetMap.get(clip.assetId) : undefined;
    // 静帧没有真实时长，允许任意拉长；视频/音频才受素材时长限制
    const assetDur =
      !clip.assetId || asset?.type === "image" ? Infinity : (asset?.durationMs ?? Infinity);

    const onMove = (ev: PointerEvent) => {
      const dxMs = ((ev.clientX - startX) / pps) * 1000;
      update((d) => {
        const t = d.tracks.find((t) => t.id === trackId)!;
        const c = t.clips.find((c) => c.id === clipId)!;
        if (mode === "move") {
          c.startMs = Math.max(0, Math.round((orig.startMs + dxMs) / 100) * 100);
        } else if (mode === "trim-l") {
          const newIn = Math.min(Math.max(0, orig.inMs + dxMs), orig.outMs - 100);
          c.inMs = Math.round(newIn / 100) * 100;
          c.startMs = Math.max(0, orig.startMs + (c.inMs - orig.inMs));
        } else {
          c.outMs = Math.min(Math.max(orig.inMs + 100, orig.outMs + dxMs), assetDur);
          c.outMs = Math.round(c.outMs / 100) * 100;
        }
        return d;
      });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // ---------------------------------------------------------------------------
  // 导出
  // ---------------------------------------------------------------------------

  const doExport = async () => {
    if (!doc) return;
    setExportJob({ id: "", status: "submitting" });
    try {
      const job = await submitRender(projectId, burnSubs);
      setExportJob({ id: job.id, status: "running" });
      const done = await waitForJob(job.id, 30 * 60_000);
      const result = JSON.parse(done.resultJson ?? "{}") as { assetId?: string };
      setExportJob({ id: job.id, status: "done", assetId: result.assetId });
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    } catch (e) {
      setExportJob({ id: "", status: "failed", error: e instanceof Error ? e.message : String(e) });
    }
  };

  // 空格播放/暂停
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "TEXTAREA" || (e.target as HTMLElement).tagName === "INPUT") return;
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selected) deleteSelected();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, doc]);

  if (!doc) return <div className="flex h-full items-center justify-center text-sm text-fg-faint">时间线加载中…</div>;

  const trackOrder = ["video", "audio", "subtitle"] as const;
  const sortedTracks = [...doc.tracks].sort(
    (a, b) => trackOrder.indexOf(a.type) - trackOrder.indexOf(b.type),
  );

  return (
    <div className="flex h-full flex-col p-4">
      {/* 工具栏 */}
      {lipsNotes.length > 0 ? (
        <p className="mb-2 rounded-lg border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          {lipsNotes.length} 镜对口型没过。原视频还在，没有改成静帧。{lipsNotes[0]?.lipsNote}
        </p>
      ) : null}
      <p className="mb-2 text-[11px] text-fg-faint">出片后画面和字幕会自动装上。配音要在这里选音色、试听，再铺上。</p>
      {doc.tracks.find((t) => t.type === "video")?.clips.length ? (
        <VoicePicker
          projectId={projectId}
          busy={ttsBusy}
          onDub={async (voice, endpointId) => {
            setTtsBusy(true);
            setTtsError("");
            try {
              const job = await submitTimelineFinish(projectId, {
                withSubtitles: autoSubtitles,
                dub: true,
                voice,
                ttsEndpointId: endpointId,
              });
              await waitForJob(job.id, 15 * 60_000);
              const next = await api<{ doc: TimelineDoc }>(`/api/timeline/project/${projectId}`);
              setDoc(next.doc);
              queryClient.invalidateQueries({ queryKey: ["assets"] });
            } catch (e) {
              setTtsError(e instanceof Error ? e.message : String(e));
            } finally {
              setTtsBusy(false);
            }
          }}
        />
      ) : null}
      {ttsError ? <p className="mb-2 text-[11px] text-red-300">{ttsError}</p> : null}
      <div className="mb-3 flex items-center gap-2">
        <h1 className="mr-2 text-sm font-semibold">时间线</h1>
        {doc.width < doc.height ? (
          <span className="rounded-full border border-line px-2 py-0.5 text-[10px] text-fg-faint">竖屏 {doc.width}×{doc.height}</span>
        ) : null}
        <ToolBtn
          onClick={async () => {
            try {
              const job = await apiJson<Job>("/api/pipelines/render-episode", "post", {
                projectId,
                withSubtitles: autoSubtitles,
              });
              await waitForJob(job.id, 20 * 60_000);
              const r = await api<{ doc: TimelineDoc }>(`/api/timeline/project/${projectId}`);
              setDoc(r.doc);
              queryClient.invalidateQueries({ queryKey: ["assets"] });
              queryClient.invalidateQueries({ queryKey: ["pipelines", projectId] });
            } catch (e) {
              alert(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          出这一集
        </ToolBtn>
        <ToolBtn onClick={fromCanvas} disabled={assembling}>
          {assembling ? "装配中…" : "从画布装上"}
        </ToolBtn>
        <ToolBtn onClick={() => setPicking(true)}>{iconPlus({ width: 12, height: 12 })} 添加素材</ToolBtn>
        <ToolBtn onClick={() => setPickingBgm(true)}>铺配乐</ToolBtn>
        <ToolBtn
          onClick={async () => {
            try {
              const r = await apiJson<{ draftDir: string; copiedToApp: string | null; hint: string }>(
                `/api/timeline/project/${projectId}/jianying`,
                "post",
              );
              setDraftHint(r.hint + (r.copiedToApp ? "" : ` ${r.draftDir}`));
            } catch (e) {
              setDraftHint(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          导出剪映草稿
        </ToolBtn>
        <ToolBtn onClick={() => srtInput.current?.click()}>{iconUpload({ width: 12, height: 12 })} 导入 SRT</ToolBtn>
        <ToolBtn onClick={addSubtitle}>加字幕</ToolBtn>
        <label className="flex items-center gap-1.5 text-[11px] text-fg-dim">
          <input
            type="checkbox"
            className="accent-amber-400"
            checked={autoSubtitles}
            onChange={(e) => {
              patchPrefs({ autoSubtitles: e.target.checked });
              setBurnSubs(e.target.checked);
            }}
          />
          配字幕
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-fg-dim">
          <input
            type="checkbox"
            className="accent-amber-400"
            checked={burnSubs}
            onChange={(e) => setBurnSubs(e.target.checked)}
          />
          导出烧字幕
        </label>
        <div className="mx-1 h-4 w-px bg-line" />
        <ToolBtn onClick={splitAtPlayhead}>分割</ToolBtn>
        <ToolBtn onClick={deleteSelected} disabled={!selected}>删除</ToolBtn>
        <div className="mx-1 h-4 w-px bg-line" />
        <label className="flex items-center gap-1.5 text-[11px] text-fg-faint">
          缩放
          <input
            type="range" min={10} max={200} value={pps}
            onChange={(e) => setPps(Number(e.target.value))}
            className="w-20 accent-amber-400"
          />
        </label>
        <span className="ml-2 text-[10px] text-fg-faint">
          {saveState === "saved" ? "已保存" : saveState === "saving" ? "保存中…" : "待保存"}
        </span>
        {ttsError && <span className="ml-2 text-[11px] text-amber-300">{ttsError}</span>}
        <button
          className="ml-auto rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-black hover:brightness-110 disabled:opacity-40"
          disabled={exportJob?.status === "running" || exportJob?.status === "submitting"}
          onClick={doExport}
        >
          {exportJob?.status === "running" ? "导出中…" : "导出 MP4"}
        </button>
        <input
          ref={srtInput} type="file" accept=".srt" hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importSrt(f);
            e.target.value = "";
          }}
        />
      </div>
      {draftHint ? <p className="mb-2 text-[11px] text-fg-dim">{draftHint}</p> : null}

      {/* 导出结果提示 */}
      {exportJob && exportJob.status !== "running" && exportJob.status !== "submitting" && (
        <div
          className={`mb-3 flex items-center justify-between rounded-lg px-3 py-2 text-xs ${
            exportJob.status === "done"
              ? "border border-emerald-900/50 bg-emerald-950/30 text-emerald-300"
              : "border border-red-900/50 bg-red-950/30 text-red-300"
          }`}
        >
          {exportJob.status === "done" ? (
            <>
              <span>导出完成，已收入资产库</span>
              <a className="underline hover:text-emerald-200" href="/assets">去资产库查看 →</a>
            </>
          ) : (
            <span>导出失败：{exportJob.error}</span>
          )}
          <button className="ml-2 opacity-60 hover:opacity-100" onClick={() => setExportJob(null)}>✕</button>
        </div>
      )}

      {/* 预览 */}
      <div className="mx-auto mb-3 w-full max-w-2xl">
        <PreviewPlayer
          doc={doc}
          playheadMs={playheadMs}
          playing={playing}
          totalMs={contentMs || totalMs}
          onSeekTimeline={(ms) => setPlayheadMs(Math.max(0, Math.min(ms, totalMs)))}
          onPause={() => setPlaying(false)}
        />
        <div className="mt-1.5 flex items-center justify-center gap-3 text-[11px] text-fg-faint">
          <button
            className="rounded-md border border-line px-3 py-1 text-fg-dim hover:text-fg"
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? "暂停" : "播放"}
          </button>
          <span className="font-mono">{fmtMs(playheadMs)} / {fmtMs(totalMs)}</span>
          <span>空格键播放/暂停 · 配音跟着播</span>
        </div>
      </div>

      {selected && (() => {
        const clip = doc.tracks.flatMap((t) => t.clips).find((c) => c.id === selected);
        const track = doc.tracks.find((t) => t.clips.some((c) => c.id === selected));
        if (!clip || !track || track.type === "subtitle") return null;
        return (
          <div className="mb-2 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2 text-[11px] text-fg-dim">
            <span className="text-fg-faint">选中片段</span>
            <label className="flex items-center gap-1.5">
              变速
              <select
                className="rounded-md border border-line bg-panel-2 px-2 py-0.5"
                value={clip.speed ?? 1}
                onChange={(e) => {
                  const speed = Number(e.target.value);
                  update((d) => {
                    for (const t of d.tracks) {
                      const c = t.clips.find((x) => x.id === selected);
                      if (c) c.speed = speed;
                    }
                    return d;
                  });
                }}
              >
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((n) => (
                  <option key={n} value={n}>{n}×</option>
                ))}
              </select>
            </label>
            {track.type === "video" && (
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  className="accent-amber-400"
                  checked={clip.transition === "fade"}
                  onChange={(e) => {
                    const on = e.target.checked;
                    update((d) => {
                      for (const t of d.tracks) {
                        const c = t.clips.find((x) => x.id === selected);
                        if (c) {
                          c.transition = on ? "fade" : "none";
                          c.transitionMs = on ? 400 : undefined;
                        }
                      }
                      return d;
                    });
                  }}
                />
                淡入淡出
              </label>
            )}
          </div>
        );
      })()}

      {/* 轨道区 */}
      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-line bg-panel">
        {/* 标尺：左侧留出与轨名相同的 64px，点击位置才和片段对齐 */}
        <div className="sticky top-0 z-10 flex h-6 items-end border-b border-line bg-panel-2">
          <div className="sticky left-0 z-10 w-16 shrink-0 border-r border-line bg-panel-2" />
          <div
            className="relative h-full cursor-pointer"
            style={{ width: msToPx(totalMs) + 200 }}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setPlayheadMs(Math.max(0, Math.round(((e.clientX - rect.left) / pps) * 1000 / 100) * 100));
            }}
          >
            {Array.from({ length: Math.ceil(totalMs / 1000) + 1 }, (_, i) => (
              <div key={i} className="absolute bottom-0 border-l border-line" style={{ left: msToPx(i * 1000), height: i % 5 === 0 ? 14 : 7 }}>
                {i % 5 === 0 && <span className="ml-0.5 text-[9px] text-fg-faint">{i}s</span>}
              </div>
            ))}
          </div>
        </div>

        {/* 轨道 */}
        <div className="relative" style={{ width: 64 + msToPx(totalMs) + 200 }}>
          {/* 播放头：轨名占 64px */}
          <div
            className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-accent"
            style={{ left: 64 + msToPx(playheadMs) }}
          >
            <div className="absolute -top-0 -left-1.5 h-3 w-3 rotate-45 bg-accent" />
          </div>

          {sortedTracks.map((track) => (
            <TrackLane
              key={track.id}
              track={track}
              pps={pps}
              selected={selected}
              assetMap={assetMap}
              onSelect={setSelected}
              onDrag={startDrag}
              onEditSubtitle={(id) => setEditingSub(id)}
            />
          ))}
        </div>
      </div>

      {picking && (
        <AssetPickerModal
          accept={["image", "video", "audio"]}
          onClose={() => setPicking(false)}
          onSelect={(a) => {
            addAssetClip(a);
            setPicking(false);
          }}
        />
      )}
      {pickingBgm && (
        <AssetPickerModal
          accept={["audio"]}
          onClose={() => setPickingBgm(false)}
          onSelect={async (a) => {
            setPickingBgm(false);
            try {
              const r = await apiJson<{ doc: TimelineDoc }>(`/api/timeline/project/${projectId}/bgm`, "post", {
                assetId: a.id,
              });
              setDoc(r.doc);
              setSaveState("saved");
            } catch (e) {
              setTtsError(e instanceof Error ? e.message : String(e));
            }
          }}
        />
      )}

      {editingSub && doc && (
        <SubtitleEditModal
          clipId={editingSub}
          doc={doc}
          onClose={() => setEditingSub(null)}
          onSave={(text) => {
            update((d) => {
              for (const t of d.tracks) {
                const c = t.clips.find((c) => c.id === editingSub);
                if (c) c.text = text;
              }
              return d;
            });
            setEditingSub(null);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ToolBtn(props: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      className="flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs text-fg-dim hover:bg-panel-2 hover:text-fg disabled:opacity-40"
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {props.children}
    </button>
  );
}

function TrackLane(props: {
  track: TimelineTrack;
  pps: number;
  selected: string | null;
  assetMap: Map<string, Asset>;
  onSelect: (id: string) => void;
  onDrag: (e: React.PointerEvent, trackId: string, clipId: string, mode: "move" | "trim-l" | "trim-r") => void;
  onEditSubtitle: (id: string) => void;
}) {
  const { track, pps } = props;
  const msToPx = (ms: number) => (ms / 1000) * pps;
  const laneColor =
    track.type === "video" ? "bg-sky-500/15 border-sky-700/50" : track.type === "audio" ? "bg-emerald-500/15 border-emerald-700/50" : "bg-amber-500/15 border-amber-700/50";

  return (
    <div className="flex border-b border-line/60">
      <div className="sticky left-0 z-10 w-16 shrink-0 border-r border-line bg-panel px-2 py-2 text-[10px] text-fg-faint">
        {track.name}
      </div>
      <div className="relative h-16 flex-1">
        {[...track.clips]
          .sort((a, b) => a.startMs - b.startMs)
          .map((clip) => {
            const asset = clip.assetId ? props.assetMap.get(clip.assetId) : null;
            const w = Math.max(8, msToPx(clipDuration(clip)));
            return (
              <div
                key={clip.id}
                className={`group absolute top-1.5 bottom-1.5 overflow-hidden rounded-md border ${laneColor} ${
                  props.selected === clip.id ? "ring-1 ring-accent" : ""
                }`}
                style={{ left: msToPx(clip.startMs), width: w }}
                onPointerDown={(e) => props.onDrag(e, track.id, clip.id, "move")}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onSelect(clip.id);
                }}
                onDoubleClick={() => track.type === "subtitle" && props.onEditSubtitle(clip.id)}
              >
                {/* 内容 */}
                <div className="pointer-events-none flex h-full items-center gap-1.5 px-1.5">
                  {track.type === "video" && asset?.thumbPath && (
                    <img
                      src={`/api/assets/${asset.id}/file?variant=thumb`}
                      className="h-full w-10 shrink-0 rounded-sm object-cover"
                      draggable={false}
                    />
                  )}
                  <span className="truncate text-[10px] text-fg-dim">
                    {track.type === "subtitle" ? clip.text : (asset?.title ?? "…")}
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-[9px] text-fg-faint">
                    {fmtMs(clipDuration(clip))}
                  </span>
                </div>
                {/* 裁剪手柄 */}
                <div
                  className="absolute top-0 bottom-0 left-0 w-2 cursor-ew-resize bg-white/0 hover:bg-accent/40"
                  onPointerDown={(e) => props.onDrag(e, track.id, clip.id, "trim-l")}
                />
                <div
                  className="absolute top-0 bottom-0 right-0 w-2 cursor-ew-resize bg-white/0 hover:bg-accent/40"
                  onPointerDown={(e) => props.onDrag(e, track.id, clip.id, "trim-r")}
                />
              </div>
            );
          })}
      </div>
    </div>
  );
}

function SubtitleEditModal(props: { clipId: string; doc: TimelineDoc; onClose: () => void; onSave: (text: string) => void }) {
  const clip = props.doc.tracks.flatMap((t) => t.clips).find((c) => c.id === props.clipId);
  const [text, setText] = useState(clip?.text ?? "");
  return (
    <Modal title="编辑字幕" onClose={props.onClose} width="w-[420px]">
      <div className="space-y-3">
        <textarea
          autoFocus
          rows={3}
          className="w-full resize-none rounded-lg border border-line bg-panel-2 p-3 text-sm outline-none focus:border-accent-dim"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {clip && (
          <p className="font-mono text-[10px] text-fg-faint">
            {msToSrtTime(clip.startMs)} → {msToSrtTime(clip.startMs + clipDuration(clip))}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button className="rounded-lg border border-line px-4 py-1.5 text-sm text-fg-dim hover:bg-panel-2" onClick={props.onClose}>
            取消
          </button>
          <button
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-black hover:brightness-110"
            onClick={() => props.onSave(text.trim() || " ")}
          >
            保存
          </button>
        </div>
      </div>
    </Modal>
  );
}
