import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { jobStatusLabels, jobTypeLabels, type Job, type JobStatus } from "@vw/core";
import { api, apiJson } from "../lib/api";
import { formatTime } from "../lib/format";
import { listHomeWorks, saveHomeDraft, syncHomeWorks, workStatusLabels } from "../lib/homeDraft";
import { useAppStore } from "../lib/store";
import { iconRefresh, iconX } from "../lib/icons";
import { Modal } from "../components/modal";

const statusStyle: Record<JobStatus, string> = {
  queued: "bg-panel-2 text-fg-dim",
  running: "bg-accent/15 text-accent",
  done: "bg-emerald-500/15 text-emerald-400",
  failed: "bg-red-500/15 text-red-400",
  canceled: "bg-panel-2 text-fg-faint",
};

const tabs: Array<{ key: string; label: string }> = [
  { key: "", label: "全部" },
  { key: "active", label: "运行中" },
  { key: "done", label: "成功" },
  { key: "failed", label: "失败" },
  { key: "canceled", label: "已取消" },
];

type JobsPageData = { items: Job[]; total: number; page: number; pageSize: number };

export function JobsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const liveJobs = useAppStore((s) => s.liveJobs);
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);

  const openJob = (job: Job) => {
    let assetId = "";
    try {
      assetId = String((JSON.parse(job.resultJson ?? "{}") as { assetId?: string }).assetId ?? "");
    } catch {
      assetId = "";
    }
    if (job.type === "timeline.finish" && job.projectId) {
      setCurrentProject(job.projectId);
      navigate("/timeline");
      return;
    }
    if (job.type === "gen.video" && job.status === "done" && job.projectId) {
      setCurrentProject(job.projectId);
      navigate("/canvas");
      return;
    }
    if (job.type === "gen.video" && job.status === "done" && assetId) {
      navigate(`/assets?focus=${encodeURIComponent(assetId)}`);
      return;
    }
    if (job.type === "gen.video" && job.projectId) {
      setCurrentProject(job.projectId);
      navigate("/canvas");
      return;
    }
    setDetail(job);
  };

  const jobTitle = (job: Job) => {
    if (job.type === "gen.video" && job.status === "done") return "出片了，去时间线";
    if (job.type === "gen.video") return "出片";
    if (job.type === "timeline.finish" && job.status === "running") return "正在装时间线";
    if (job.type === "timeline.finish" && job.status === "done") return job.message?.includes("已配") ? "配音好了" : "画面字幕好了";
    return jobTypeLabels[job.type] ?? job.type;
  };
  const [tab, setTab] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<Job | null>(null);
  const [worksTick, setWorksTick] = useState(0);

  useEffect(() => {
    void Promise.all([
      api<{ items: Job[] }>("/api/jobs?type=compose.keys&pageSize=40"),
      api<{ items: Job[] }>("/api/jobs?type=gen.video&status=done&pageSize=40"),
    ])
      .then(([keys, videos]) => {
        syncHomeWorks([...(keys.items ?? []), ...(videos.items ?? []), ...Object.values(liveJobs)]);
        setWorksTick((n) => n + 1);
      })
      .catch(() => {
        /* 清不掉待办就算了 */
      });
    // 只拉一次库存；后面靠 liveJobs 往前推
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    syncHomeWorks(Object.values(liveJobs));
    setWorksTick((n) => n + 1);
  }, [liveJobs]);

  const pending = useMemo(() => listHomeWorks().filter((w) => w.step !== "write"), [worksTick]);

  const { data } = useQuery({
    queryKey: ["jobs", tab, page],
    queryFn: () => api<JobsPageData>(`/api/jobs?page=${page}&pageSize=20${tab ? `&status=${tab}` : ""}`),
    refetchInterval: 30_000,
  });

  const merged = useMemo(() => {
    const map = new Map<string, Job>();
    for (const j of data?.items ?? []) map.set(j.id, j);
    for (const j of Object.values(liveJobs)) {
      if (tab === "active" && (j.status === "queued" || j.status === "running")) map.set(j.id, j);
      else if (tab && tab !== "active" && j.status === tab) map.set(j.id, j);
      else if (!tab) map.set(j.id, j);
    }
    return [...map.values()].sort((a, b) => b.createdAt - a.createdAt);
  }, [data, liveJobs, tab]);

  const total = data?.total ?? merged.length;
  const pageSize = data?.pageSize ?? 20;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const cancelMutation = useMutation({
    mutationFn: (id: string) => apiJson(`/api/jobs/${id}/cancel`, "post"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });
  const retryMutation = useMutation({
    mutationFn: (id: string) => apiJson(`/api/jobs/${id}/retry`, "post"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-lg font-semibold">任务中心</h1>
        <p className="mt-0.5 text-xs text-fg-faint">耗时操作在这里排队。点一条看详情。</p>
      </div>

      {pending.length > 0 && (
        <div className="mb-4 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3">
          <p className="text-sm text-fg">有片子还没做完，回首页接着出。</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {pending.map((w) => (
              <button
                key={w.projectId || w.idea}
                className="rounded-full bg-accent px-3 py-1 text-[11px] font-medium text-black"
                onClick={() => {
                  saveHomeDraft(w);
                  navigate("/?return=home");
                }}
              >
                {(w.script?.title || w.idea || "未命名").slice(0, 16)} · {workStatusLabels[w.step]}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-line bg-panel p-0.5">
          {tabs.map((t) => (
            <button
              key={t.key}
              className={`rounded-md px-3 py-1.5 text-xs ${
                tab === t.key ? "bg-panel-2 text-accent" : "text-fg-dim hover:text-fg"
              }`}
              onClick={() => {
                setTab(t.key);
                setPage(1);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-fg-faint">{total} 条</span>
      </div>

      {merged.length === 0 && (
        <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-line text-sm text-fg-faint">
          暂无任务
        </div>
      )}

      <div className="space-y-2">
        {merged.map((job) => (
          <div key={job.id} className="rounded-xl border border-line bg-panel p-4">
            <div className="flex items-center gap-3">
              <span className={`rounded-full px-2 py-0.5 text-[11px] ${statusStyle[job.status]}`}>
                {jobStatusLabels[job.status]}
              </span>
              <button className="min-w-0 truncate text-left text-sm font-medium hover:text-accent" onClick={() => openJob(job)}>
                {jobTitle(job)}
              </button>
              {job.message && <span className="truncate text-xs text-fg-faint">{job.message}</span>}
              <span className="ml-auto shrink-0 text-[11px] text-fg-faint">{formatTime(job.createdAt)}</span>
              {job.status === "running" && (
                <button
                  className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-fg-dim hover:text-red-400"
                  onClick={() => cancelMutation.mutate(job.id)}
                >
                  {iconX({ width: 12, height: 12 })} 取消
                </button>
              )}
              {(job.status === "failed" || job.status === "canceled") && (
                <button
                  className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-fg-dim hover:text-accent"
                  onClick={() => retryMutation.mutate(job.id)}
                >
                  {iconRefresh({ width: 12, height: 12 })} 重试
                </button>
              )}
            </div>
            {(job.status === "running" || job.status === "queued") && (
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-panel-2">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-300"
                  style={{ width: `${Math.round(job.progress * 100)}%` }}
                />
              </div>
            )}
            {job.error && (
              <pre className="mt-3 overflow-x-auto rounded-lg bg-red-950/30 p-2.5 text-[11px] whitespace-pre-wrap text-red-300">
                {job.error}
              </pre>
            )}
          </div>
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
            {page} / {pages}
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

      {detail && <JobDetail job={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function JobDetail(props: { job: Job; onClose: () => void }) {
  const { job } = props;
  const navigate = useNavigate();
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);
  const payload = prettyJson(job.payloadJson);
  const result = prettyJson(job.resultJson);
  let assetId = "";
  try {
    assetId = String((JSON.parse(job.resultJson ?? "{}") as { assetId?: string }).assetId ?? "");
  } catch {
    assetId = "";
  }
  const title = job.type === "gen.video" && job.status === "done" ? "出片了" : (jobTypeLabels[job.type] ?? job.type);
  return (
    <Modal title={title} onClose={props.onClose} width="w-[720px]">
      {job.type === "gen.video" && job.status === "done" && assetId ? (
        <button
          className="mb-3 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-black"
          onClick={() => {
            props.onClose();
            navigate(`/assets?focus=${encodeURIComponent(assetId)}`);
          }}
        >
          打开这条片
        </button>
      ) : null}
      {job.type === "gen.video" && job.projectId ? (
        <>
          <button
            className="mb-3 ml-2 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-black"
            onClick={() => {
              props.onClose();
              if (job.projectId) setCurrentProject(job.projectId);
              navigate("/timeline");
            }}
          >
            去时间线
          </button>
          <button
            className="mb-3 ml-2 rounded-lg border border-line px-3 py-1.5 text-xs text-fg-dim"
            onClick={() => {
              props.onClose();
              if (job.projectId) setCurrentProject(job.projectId);
              navigate("/canvas");
            }}
          >
            去画布
          </button>
        </>
      ) : null}
      <div className="space-y-3 text-xs">
        <div className="flex flex-wrap gap-2">
          <span className={`rounded-full px-2 py-0.5 ${statusStyle[job.status]}`}>{jobStatusLabels[job.status]}</span>
          <span className="text-fg-faint">{formatTime(job.createdAt)}</span>
          {job.message ? <span className="text-fg-dim">{job.message}</span> : null}
        </div>
        {job.error ? (
          <pre className="overflow-x-auto rounded-lg bg-red-950/30 p-2.5 whitespace-pre-wrap text-red-300">{job.error}</pre>
        ) : null}
        {result ? (
          <div>
            <div className="mb-1 text-fg-faint">结果</div>
            <pre className="max-h-48 overflow-auto rounded-lg bg-panel-2 p-2.5 whitespace-pre-wrap text-fg-dim">{result}</pre>
          </div>
        ) : null}
        {payload ? (
          <div>
            <div className="mb-1 text-fg-faint">提交内容</div>
            <pre className="max-h-48 overflow-auto rounded-lg bg-panel-2 p-2.5 whitespace-pre-wrap text-fg-dim">{payload}</pre>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function prettyJson(raw: string | null): string {
  if (!raw) return "";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
