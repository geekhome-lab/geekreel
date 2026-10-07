import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DramaBible, Job, Series } from "@vw/core";
import { api, apiJson } from "../lib/api";
import { useAppStore } from "../lib/store";
import { waitForJob } from "../lib/runGen";
import { confirmDanger } from "../lib/prefs";
import { iconPlus, iconTrash } from "../lib/icons";

type SeriesDetail = Series & { bible: DramaBible | null };
type SeriesPageData = { items: Series[]; total: number; page: number; pageSize: number };

export function SeriesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const { data } = useQuery({
    queryKey: ["series", q, page],
    queryFn: () => api<SeriesPageData>(`/api/series?q=${encodeURIComponent(q)}&page=${page}&pageSize=8`),
  });
  const list = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / (data?.pageSize ?? 8)));

  const del = useMutation({
    mutationFn: (id: string) => apiJson(`/api/series/${id}`, "delete"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["series"] }),
  });

  return (
    <div className="mx-auto h-full max-w-4xl overflow-y-auto p-6">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="text-lg font-semibold">连载</h1>
          <p className="mt-0.5 text-xs text-fg-faint">
            只有勾了连载的片子会出现在这里。抖音热点单条不会进来。
          </p>
        </div>
        <button
          className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-black"
          onClick={() => navigate("/drama")}
        >
          {iconPlus({ width: 12, height: 12 })} 新开一部
        </button>
      </div>

      <input
        className="mb-4 w-full rounded-xl border border-line bg-panel px-3 py-2 text-sm outline-none placeholder:text-fg-faint"
        placeholder="搜连载名…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPage(1);
        }}
      />

      {list.length === 0 && (
        <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-fg-faint">
          还没有连载。去「小说转短剧」上传正文，做成短剧连载。
        </p>
      )}

      <div className="space-y-3">
        {list.map((s) => (
          <SeriesCard
            key={s.id}
            series={s}
            onContinue={() => navigate(`/drama?series=${s.id}`)}
            onOpen={() => {
              if (!s.lastProjectId) return;
              setCurrentProject(s.lastProjectId);
              navigate("/canvas");
            }}
            onDelete={() => {
              if (confirmDanger(`关掉连载「${s.name}」？项目文件还在，只是不再挂在这部下面。`)) del.mutate(s.id);
            }}
          />
        ))}
      </div>

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2 text-xs">
          <button
            className="rounded-lg border border-line px-3 py-1 text-fg-dim disabled:opacity-40"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            上一页
          </button>
          <span className="text-fg-faint">
            {page} / {pages} · 共 {total} 部
          </span>
          <button
            className="rounded-lg border border-line px-3 py-1 text-fg-dim disabled:opacity-40"
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}

function SeriesCard(props: {
  series: Series;
  onContinue: () => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { series: s } = props;
  const navigate = useNavigate();
  const { data: detail } = useQuery({
    queryKey: ["series", s.id],
    queryFn: () => api<SeriesDetail>(`/api/series/${s.id}`),
  });
  const cast = detail?.bible?.cast ?? [];
  const kindLabel = s.kind === "whiteboard" ? "白板" : s.kind === "free" ? "自由" : "短剧";

  return (
    <article className="rounded-xl border border-line bg-panel p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium">{s.name}</h2>
            <span className="rounded-full bg-panel-2 px-2 py-0.5 text-[10px] text-fg-faint">{kindLabel}</span>
            <span className="text-[11px] text-fg-faint">已 {s.episodeCount} 集</span>
          </div>
          {detail?.bible?.episodes?.some((e) => e.shots.some((sh) => sh.lipsNote)) ? (
            <p className="mt-2 text-[11px] text-amber-300">有几镜对口型没过。原视频还在，没有改成静帧。</p>
          ) : null}
          {cast.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {cast.slice(0, 8).map((c) => (
                <div key={c.id} className="flex items-center gap-1.5">
                  {c.imageAssetId ? (
                    <img src={`/api/assets/${c.imageAssetId}/file?variant=thumb`} alt="" className="h-8 w-8 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-panel-2 text-[10px] text-fg-faint">
                      {c.name.slice(0, 1)}
                    </div>
                  )}
                  <span className="text-[11px] text-fg-dim">{c.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-black" onClick={props.onContinue}>
            接到这部，做下一集
          </button>
          <button
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-fg-dim disabled:opacity-40"
            disabled={!s.lastProjectId}
            onClick={async () => {
              if (!s.lastProjectId) return;
              try {
                const job = await apiJson<Job>("/api/pipelines/render-episode", "post", {
                  projectId: s.lastProjectId,
                  withSubtitles: true,
                });
                await waitForJob(job.id, 20 * 60_000);
                useAppStore.getState().setCurrentProject(s.lastProjectId);
                navigate("/timeline");
              } catch (e) {
                alert(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            出这一集
          </button>
          <button
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-fg-dim disabled:opacity-40"
            disabled={!s.lastProjectId}
            onClick={props.onOpen}
          >
            打开上集画布
          </button>
          <button className="rounded-lg border border-line px-2 py-1.5 text-fg-faint hover:text-red-400" onClick={props.onDelete}>
            {iconTrash({ width: 12, height: 12 })}
          </button>
        </div>
      </div>
    </article>
  );
}
