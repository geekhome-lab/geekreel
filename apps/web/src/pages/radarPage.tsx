import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { topicSearchUrl, type Job, type RadarItem, type RadarSource } from "@vw/core";
import { api, apiJson } from "../lib/api";
import { emptyHomeDraft, parkCurrent, saveHomeDraft } from "../lib/homeDraft";
import { waitForJob } from "../lib/runGen";
import { iconRefresh, iconSearch } from "../lib/icons";

export function RadarPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const highlight = searchParams.get("item");

  const [platform, setPlatform] = useState("");
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<"refresh" | "search" | null>(null);
  const [makingId, setMakingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const { data: status } = useQuery({
    queryKey: ["radar-status"],
    queryFn: () => api<{ hasWebSearchLlm: boolean; hasFeedSources: boolean }>("/api/radar/status"),
  });
  const { data: sources } = useQuery({
    queryKey: ["radar-sources"],
    queryFn: () => api<RadarSource[]>("/api/radar/sources?board=1"),
  });
  const { data: items } = useQuery({
    queryKey: ["radar-board"],
    queryFn: () => api<RadarItem[]>("/api/radar/board"),
  });

  const canFetch = !!status?.hasWebSearchLlm;
  const current = sources?.find((s) => s.platform === platform) ?? null;

  const shown = useMemo(() => {
    const list = (items ?? []).filter((it) => !platform || it.platform === platform);
    const kw = draft.trim().toLowerCase();
    if (!kw) return list;
    return list.filter((it) => `${it.title}\n${it.summary}`.toLowerCase().includes(kw));
  }, [items, platform, draft]);

  const switchPlatform = (p: string) => {
    setPlatform(p);
    setDraft("");
    setQ("");
    setError("");
  };

  const run = async (mode: "refresh" | "search", query?: string) => {
    if (!current) {
      setError("先点上面一个平台，再刷新或搜索");
      return;
    }
    setError("");
    setBusy(mode);
    try {
      const job = await apiJson<Job>(`/api/radar/sources/${current.id}/run`, "post", {
        q: query || undefined,
      });
      await waitForJob(job.id, 3 * 60_000);
      qc.invalidateQueries({ queryKey: ["radar-board"] });
      qc.invalidateQueries({ queryKey: ["radar-sources"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const search = () => {
    if (!current) {
      setError("先点上面一个平台，再搜");
      return;
    }
    const kw = draft.trim();
    setQ(kw);
    if (kw) void run("search", kw);
  };

  const makeVideo = async (item: RadarItem) => {
    setError("");
    setMakingId(item.id);
    try {
      const r = await apiJson<{ idea: string; title: string; platform: string; itemId: string }>(
        "/api/radar/to-story",
        "post",
        { itemId: item.id },
      );
      parkCurrent();
      saveHomeDraft({
        ...emptyHomeDraft(),
        idea: r.idea,
        step: "write",
        source: "radar",
        radarItemId: r.itemId,
        radarPlatform: r.platform || item.platform,
      });
      navigate("/?from=radar");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setMakingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-5">
        <h1 className="text-lg font-semibold">热点雷达</h1>
        <p className="mt-0.5 text-xs text-fg-faint">用联网文本模型查热点。热度是估计，不是官方榜。</p>
      </div>

      {status && !status.hasWebSearchLlm && (
        <div className="mb-4 rounded-xl border border-amber-900/50 bg-amber-950/30 px-4 py-3 text-xs text-amber-200">
          还没有会联网的文本模型。到模型页勾选「支持联网搜索」后再刷新。
          <button className="ml-2 underline hover:text-amber-100" onClick={() => navigate("/models")}>
            去模型页 →
          </button>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          className={`rounded-md px-2.5 py-1 text-[11px] ${platform === "" ? "bg-panel-2 text-accent" : "text-fg-dim hover:text-fg"}`}
          onClick={() => switchPlatform("")}
        >
          全部
        </button>
        {(sources ?? []).map((s) => (
          <button
            key={s.id}
            className={`rounded-md px-2.5 py-1 text-[11px] ${platform === s.platform ? "bg-panel-2 text-accent" : "text-fg-dim hover:text-fg"}`}
            onClick={() => switchPlatform(s.platform)}
          >
            {s.platform}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-fg-faint">热度 = AI 估计</span>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex min-w-[200px] flex-1 items-center gap-1.5 rounded-lg border border-line bg-panel-2 px-2.5 sm:max-w-xs">
          {iconSearch({ width: 12, height: 12, className: "shrink-0 text-fg-faint" })}
          <input
            className="h-8 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-fg-faint"
            placeholder={current ? `搜${current.platform}，比如 AI` : "先选一个平台再搜"}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (!e.target.value.trim()) setQ("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                search();
              }
            }}
          />
          {draft && (
            <button
              type="button"
              className="text-[10px] text-fg-faint hover:text-fg"
              onClick={() => {
                setDraft("");
                setQ("");
                setError("");
              }}
            >
              清除
            </button>
          )}
        </div>
        <button
          className="rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-fg-dim hover:text-fg disabled:opacity-40"
          disabled={!canFetch || !current || !!busy || !draft.trim()}
          onClick={search}
        >
          {busy === "search" ? "在搜…" : "搜索"}
        </button>
        <button
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-black hover:brightness-110 disabled:opacity-40"
          disabled={!canFetch || !current || !!busy}
          onClick={() => void run("refresh")}
        >
          {iconRefresh({ width: 12, height: 12 })}
          {busy === "refresh" ? "正在问模型…" : current ? `刷新${current.platform}` : "刷新"}
        </button>
      </div>

      {error && <div className="mb-3 rounded-lg bg-red-950/30 px-3 py-2 text-xs text-red-300">{error}</div>}
      {current?.lastError && !error && <div className="mb-3 text-[11px] text-red-400">{current.lastError}</div>}

      {shown.length === 0 && (
        <div className="rounded-xl border border-dashed border-line py-16 text-center text-sm text-fg-faint">
          {q && current
            ? `还没有「${q}」相关热点。点搜索去${current.platform}上查。`
            : current
              ? `还没有${current.platform}热点。点「刷新${current.platform}」。`
              : "还没有热点。先点一个平台再刷新。"}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {shown.map((it) => (
          <article
            key={it.id}
            className={`rounded-xl border bg-panel p-4 ${highlight === it.id ? "border-accent" : "border-line"}`}
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] text-sky-300">{it.platform}</span>
              <span className="text-[10px] text-fg-faint" title="AI 估计">
                热度 {it.heat}
                {it.heatText ? ` · ${it.heatText}` : ""}
              </span>
            </div>
            <h3 className="text-sm font-medium leading-snug">{it.title}</h3>
            {it.summary && <p className="mt-1.5 text-xs leading-relaxed text-fg-dim">{it.summary}</p>}
            <div className="mt-3 flex items-center gap-2">
              <button
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-black hover:brightness-110 disabled:opacity-40"
                disabled={makingId === it.id}
                onClick={() => void makeVideo(it)}
              >
                {makingId === it.id ? "在提炼…" : "做成视频"}
              </button>
              <a
                className="text-[11px] text-fg-faint underline hover:text-fg"
                href={topicSearchUrl(it.platform, it.title)}
                target="_blank"
                rel="noreferrer"
              >
                原文
              </a>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
