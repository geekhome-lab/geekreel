import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { Job, Series, StylePackPublic } from "@vw/core";
import { api, apiJson } from "../lib/api";
import { useAppStore } from "../lib/store";
import { waitForJob } from "../lib/runGen";
import { iconPlay, iconUpload } from "../lib/icons";

type Source = "file" | "url" | "paste";
type SeriesMode = "new" | "continue";

export function DramaPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);
  const setPendingAutoRun = useAppStore((s) => s.setPendingAutoRun);

  const { data: packs } = useQuery({
    queryKey: ["styles"],
    queryFn: () => api<StylePackPublic[]>("/api/styles"),
  });
  const { data: seriesList } = useQuery({
    queryKey: ["series"],
    queryFn: () => api<Series[]>("/api/series"),
  });

  const dramaPacks = (packs ?? []).filter((p) => p.ready && p.id !== "whiteboard");
  const smy = dramaPacks.find((p) => p.id === "smy-animation") ?? dramaPacks[0] ?? null;

  useEffect(() => {
    const sid = params.get("series");
    if (!sid) return;
    const s = seriesList?.find((x) => x.id === sid);
    if (!s) return;
    setSeriesMode("continue");
    setSeriesId(s.id);
    if (s.stylePackId) setPackId(s.stylePackId);
    if (s.substyle) setSubstyle(s.substyle);
  }, [params, seriesList]);

  const [source, setSource] = useState<Source>("file");
  const [fileLabel, setFileLabel] = useState("");
  const [url, setUrl] = useState("");
  const [story, setStory] = useState("");
  const [clipped, setClipped] = useState(false);
  const [packId, setPackId] = useState("smy-animation");
  const [substyle, setSubstyle] = useState("flat");
  const [seriesMode, setSeriesMode] = useState<SeriesMode>(params.get("series") ? "continue" : "new");
  const [seriesName, setSeriesName] = useState("");
  const [seriesId, setSeriesId] = useState(params.get("series") ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pack = dramaPacks.find((p) => p.id === packId) ?? smy;
  const chosenSeries = seriesList?.find((s) => s.id === seriesId);
  const dramaSeries = (seriesList ?? []).filter((s) => s.kind === "drama" || s.kind === "free");

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    setFileLabel(file.name);
    const text = await file.text();
    if (text.trim().length < 20) {
      setError("这个文件几乎是空的。请上传小说正文 txt / md。");
      return;
    }
    const clip = await apiJson<{ text: string; clipped: boolean }>("/api/series/clip", "post", { text });
    setStory(clip.text);
    setClipped(clip.clipped);
    setError("");
    if (!seriesName) setSeriesName(file.name.replace(/\.[^.]+$/, "").slice(0, 24));
  };

  const loadUrl = async () => {
    if (!url.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const doc = await apiJson<{ title: string; text: string; clipped: boolean }>("/api/series/fetch", "post", { url: url.trim() });
      setStory(doc.text);
      setClipped(doc.clipped);
      if (!seriesName) setSeriesName(doc.title.slice(0, 24));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (!story.trim() || busy) return;
    if (seriesMode === "continue" && !seriesId) {
      setError("先选一部要接的连载。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const job = await apiJson<Job>("/api/pipelines/run", "post", {
        story: story.trim(),
        packId: pack?.id ?? "smy-animation",
        substyle: seriesMode === "continue" ? chosenSeries?.substyle || substyle : substyle,
        seriesId: seriesMode === "continue" ? seriesId : undefined,
        seriesName: seriesMode === "new" ? seriesName.trim() || pack?.name || "短剧连载" : undefined,
        kind: "drama",
      });
      const done = await waitForJob(job.id, 8 * 60_000);
      const result = JSON.parse(done.resultJson ?? "{}") as { projectId?: string; waiting?: boolean };
      if (!result.projectId) throw new Error("没有建出项目");
      setCurrentProject(result.projectId);
      setPendingAutoRun(!result.waiting);
      navigate("/canvas");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto h-full max-w-3xl overflow-y-auto p-6">
      <h1 className="text-lg font-semibold">小说转短剧</h1>
      <p className="mt-1 mb-5 text-xs text-fg-faint">
        上传小说或贴能直接打开的链接。第一季拆成 5 集；下次把下一章接到同一部连载，人物和色盘会锁住。
      </p>

      <div className="mb-3 flex gap-1 rounded-lg border border-line bg-panel-2 p-1">
        {(
          [
            ["file", "上传文本"],
            ["url", "小说链接"],
            ["paste", "粘贴正文"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            className={`flex-1 rounded-md px-2 py-1.5 text-xs ${source === k ? "bg-accent text-black" : "text-fg-dim"}`}
            onClick={() => setSource(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {source === "file" && (
        <label className="mb-3 block cursor-pointer rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-fg-dim hover:border-accent-dim">
          <input type="file" accept=".txt,.md,.text" className="hidden" onChange={(e) => void loadFile(e.target.files?.[0])} />
          {iconUpload({ width: 18, height: 18 })}
          <div className="mt-2">{fileLabel || "上传 .txt / .md"}</div>
        </label>
      )}
      {source === "url" && (
        <div className="mb-3 flex gap-2">
          <input
            className="flex-1 rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent-dim"
            placeholder="能直接打开的章节链接，不要登录墙"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button className="rounded-lg border border-line px-3 py-2 text-xs text-fg-dim" disabled={busy} onClick={loadUrl}>
            {busy ? "打开中…" : "拉取"}
          </button>
        </div>
      )}
      {source === "paste" && (
        <textarea
          rows={8}
          className="mb-3 w-full resize-y rounded-xl border border-line bg-panel p-3 text-sm outline-none focus:border-accent-dim"
          placeholder="把小说正文贴进来"
          value={story}
          onChange={(e) => setStory(e.target.value)}
        />
      )}

      {story && source !== "paste" && (
        <div className="mb-3 rounded-xl border border-line bg-panel p-3 text-xs text-fg-dim">
          已读入 {story.length} 字。{clipped && "正文太长，先用前 2 万字做这一季，下一章再接到同一连载。"}
          <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-[11px] text-fg-faint">{story.slice(0, 400)}{story.length > 400 ? "…" : ""}</pre>
        </div>
      )}

      <section className="mb-4">
        <h2 className="mb-2 text-xs text-fg-faint">风格（和首页按钮无关，在这里选）</h2>
        <div className="flex flex-wrap gap-1.5">
          {dramaPacks.map((p) => (
            <button
              key={p.id}
              className={`rounded-full px-3 py-1 text-xs ${pack?.id === p.id ? "bg-accent text-black" : "border border-line text-fg-dim"}`}
              onClick={() => {
                setPackId(p.id);
                setSubstyle(p.defaultSubstyle || "");
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
        {pack && pack.substyles.length > 0 && seriesMode === "new" && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {pack.substyles.map((s) => (
              <button
                key={s.id}
                title={s.hint}
                className={`rounded-full px-2.5 py-0.5 text-[11px] ${substyle === s.id ? "bg-accent text-black" : "border border-line text-fg-dim"}`}
                onClick={() => setSubstyle(s.id)}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="mb-4">
        <h2 className="mb-2 text-xs text-fg-faint">连载</h2>
        <div className="mb-2 flex gap-2">
          <button
            className={`rounded-lg px-3 py-1.5 text-xs ${seriesMode === "new" ? "bg-accent text-black" : "border border-line text-fg-dim"}`}
            onClick={() => setSeriesMode("new")}
          >
            新开一部
          </button>
          <button
            className={`rounded-lg px-3 py-1.5 text-xs ${seriesMode === "continue" ? "bg-accent text-black" : "border border-line text-fg-dim"}`}
            onClick={() => setSeriesMode("continue")}
          >
            接到已有连载
          </button>
        </div>
        {seriesMode === "new" && (
          <input
            className="w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none"
            placeholder="连载名字，例如：武松打虎"
            value={seriesName}
            onChange={(e) => setSeriesName(e.target.value)}
          />
        )}
        {seriesMode === "continue" && (
          <div className="flex flex-wrap gap-1.5">
            {dramaSeries.length === 0 && <p className="text-xs text-fg-faint">还没有连载。先新开一部。</p>}
            {dramaSeries.map((s) => (
              <button
                key={s.id}
                className={`rounded-full px-3 py-1 text-xs ${seriesId === s.id ? "bg-accent text-black" : "border border-line text-fg-dim"}`}
                onClick={() => {
                  setSeriesId(s.id);
                  if (s.stylePackId) setPackId(s.stylePackId);
                  if (s.substyle) setSubstyle(s.substyle);
                }}
              >
                {s.name} · 已 {s.episodeCount} 集
              </button>
            ))}
          </div>
        )}
      </section>

      {error && <p className="mb-3 text-xs text-amber-300">{error}</p>}

      <button
        className="flex items-center gap-1.5 rounded-xl bg-accent px-5 py-2 text-sm font-medium text-black disabled:opacity-40"
        disabled={!story.trim() || busy}
        onClick={start}
      >
        {iconPlay({ width: 14, height: 14 })}
        {busy ? "拆集中…" : seriesMode === "continue" ? "接到这部，做下一集" : "做成短剧连载"}
      </button>
    </div>
  );
}
