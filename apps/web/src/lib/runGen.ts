import type { Job } from "@vw/core";
import { api } from "./api";
import { onWsEvent, useAppStore } from "./store";

/** 等待任务结束：WS 推送为主，轮询兜底 */
export function waitForJob(jobId: string, timeoutMs = 10 * 60_000): Promise<Job> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (job: Job) => {
      if (settled) return;
      if (job.status === "done") {
        settled = true;
        cleanup();
        resolve(job);
      } else if (job.status === "failed" || job.status === "canceled") {
        settled = true;
        cleanup();
        reject(new Error(job.error ?? "任务已取消"));
      }
    };
    const unsub = onWsEvent((ev) => {
      if (ev.type === "job.upsert" && ev.job.id === jobId) finish(ev.job);
    });
    const timer = setInterval(async () => {
      try {
        const jobs = useAppStore.getState().liveJobs;
        if (jobs[jobId]) finish(jobs[jobId]);
      } catch {
        /* 忽略轮询错误 */
      }
    }, 2000);
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error("等待任务超时"));
      }
    }, timeoutMs);
    const cleanup = () => {
      unsub();
      clearInterval(timer);
      clearTimeout(timeout);
    };
    // 已存在的状态立即判断
    const existing = useAppStore.getState().liveJobs[jobId];
    if (existing) finish(existing);
  });
}

export async function submitImageGen(input: {
  prompt: string;
  size?: string;
  endpointId?: string | null;
  projectId?: string | null;
}): Promise<Job> {
  return api<Job>("/api/gen/image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function submitRender(projectId: string): Promise<Job> {
  return api<Job>("/api/timeline/render", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId }),
  });
}
