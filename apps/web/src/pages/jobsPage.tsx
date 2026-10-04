import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { jobStatusLabels, jobTypeLabels, type Job, type JobStatus } from "@vw/core";
import { api, apiJson } from "../lib/api";
import { formatTime } from "../lib/format";
import { useAppStore } from "../lib/store";
import { iconRefresh, iconX } from "../lib/icons";

const statusStyle: Record<JobStatus, string> = {
  queued: "bg-panel-2 text-fg-dim",
  running: "bg-accent/15 text-accent",
  done: "bg-emerald-500/15 text-emerald-400",
  failed: "bg-red-500/15 text-red-400",
  canceled: "bg-panel-2 text-fg-faint",
};

export function JobsPage() {
  const queryClient = useQueryClient();
  const liveJobs = useAppStore((s) => s.liveJobs);

  const { data: jobs } = useQuery({
    queryKey: ["jobs"],
    queryFn: () => api<Job[]>("/api/jobs"),
    refetchInterval: 30_000,
  });

  // 服务器列表 + WS 实时状态合并（实时优先）
  const merged = useMemo(() => {
    const map = new Map<string, Job>();
    for (const j of jobs ?? []) map.set(j.id, j);
    for (const j of Object.values(liveJobs)) map.set(j.id, j);
    return [...map.values()].sort((a, b) => b.createdAt - a.createdAt);
  }, [jobs, liveJobs]);

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
        <p className="mt-0.5 text-xs text-fg-faint">所有耗时操作都在这里排队执行，进度实时推送</p>
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
              <span className="text-sm font-medium">{jobTypeLabels[job.type] ?? job.type}</span>
              {job.message && <span className="text-xs text-fg-faint">{job.message}</span>}
              <span className="ml-auto text-[11px] text-fg-faint">{formatTime(job.createdAt)}</span>

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
    </div>
  );
}
