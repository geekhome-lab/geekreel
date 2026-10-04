import type { Job, JobStatus } from "@vw/core";
import type { SQLQueryBindings } from "bun:sqlite";
import { db } from "../db";
import { newId, now } from "../lib/resp";
import { wsHub } from "../ws";

export interface JobContext {
  /** 上报进度（0-1）与可选消息；写库 + WS 广播 */
  progress(ratio: number, message?: string): void;
  signal: AbortSignal;
}

export type JobHandler = (job: Job, ctx: JobContext) => Promise<unknown>;

interface RunningEntry {
  abort: AbortController;
  type: string;
}

/**
 * 任务队列：内存调度 + SQLite 持久化。
 * - 按类型并发上限（默认 4）
 * - 重启恢复：queued 重跑，running 标记为中断失败
 */
class JobQueue {
  private handlers = new Map<string, JobHandler>();
  private running = new Map<string, RunningEntry>();
  private concurrency: Record<string, number> = { default: 4 };

  register(type: string, handler: JobHandler, concurrency?: number) {
    this.handlers.set(type, handler);
    if (concurrency) this.concurrency[type] = concurrency;
  }

  private rowToJob(row: Record<string, unknown>): Job {
    return row as unknown as Job;
  }

  get(id: string): Job | null {
    const row = db.query("SELECT * FROM jobs WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? this.rowToJob(row) : null;
  }

  list(opts: { status?: JobStatus; limit?: number } = {}): Job[] {
    const limit = opts.limit ?? 100;
    if (opts.status) {
      return (db.query("SELECT * FROM jobs WHERE status = ? ORDER BY createdAt DESC LIMIT ?").all(opts.status, limit) as Record<string, unknown>[]).map((r) => this.rowToJob(r));
    }
    return (db.query("SELECT * FROM jobs ORDER BY createdAt DESC LIMIT ?").all(limit) as Record<string, unknown>[]).map((r) => this.rowToJob(r));
  }

  private update(id: string, fields: Record<string, SQLQueryBindings>): Job | null {
    const keys = Object.keys(fields);
    if (keys.length === 0) return this.get(id);
    const sql = `UPDATE jobs SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`;
    db.run(sql, [...keys.map((k) => fields[k]!), id]);
    const job = this.get(id);
    if (job) wsHub.broadcast({ type: "job.upsert", job });
    return job;
  }

  submit(type: string, payload: unknown, projectId: string | null = null): Job {
    if (!this.handlers.has(type)) throw new Error(`未注册的任务类型: ${type}`);
    const id = newId();
    db.run(
      "INSERT INTO jobs (id, projectId, type, status, progress, payloadJson, createdAt) VALUES (?, ?, ?, 'queued', 0, ?, ?)",
      [id, projectId, type, JSON.stringify(payload ?? {}), now()],
    );
    const job = this.get(id)!;
    wsHub.broadcast({ type: "job.upsert", job });
    this.pump();
    return job;
  }

  cancel(id: string): Job | null {
    const job = this.get(id);
    if (!job) return null;
    if (job.status === "queued") {
      return this.update(id, { status: "canceled", finishedAt: now() });
    }
    if (job.status === "running") {
      this.running.get(id)?.abort.abort();
    }
    return job;
  }

  retry(id: string): Job | null {
    const job = this.get(id);
    if (!job || (job.status !== "failed" && job.status !== "canceled")) return job;
    const next = this.update(id, { status: "queued", progress: 0, error: null, finishedAt: null });
    this.pump();
    return next;
  }

  /** 启动时恢复：中断的 running 标记失败，queued 重新调度 */
  recover() {
    db.run(
      "UPDATE jobs SET status = 'failed', error = '服务重启导致中断', finishedAt = ? WHERE status = 'running'",
      [now()],
    );
    this.pump();
  }

  private runningCount(type: string): number {
    let n = 0;
    for (const entry of this.running.values()) if (entry.type === type) n++;
    return n;
  }

  private pump() {
    for (const [type, handler] of this.handlers) {
      const limit = this.concurrency[type] ?? this.concurrency["default"]!;
      while (this.runningCount(type) < limit) {
        const row = db
          .query("SELECT * FROM jobs WHERE status = 'queued' AND type = ? ORDER BY createdAt ASC LIMIT 1")
          .get(type) as Record<string, unknown> | null;
        if (!row) break;
        const job = this.rowToJob(row);
        void this.run(job, handler);
      }
    }
  }

  private async run(job: Job, handler: JobHandler) {
    const abort = new AbortController();
    this.running.set(job.id, { abort, type: job.type });
    this.update(job.id, { status: "running", startedAt: now() });

    const ctx: JobContext = {
      signal: abort.signal,
      progress: (ratio, message) => {
        this.update(job.id, {
          progress: Math.max(0, Math.min(1, ratio)),
          ...(message !== undefined ? { message } : {}),
        });
      },
    };

    try {
      const result = await handler(this.get(job.id)!, ctx);
      this.update(job.id, {
        status: abort.signal.aborted ? "canceled" : "done",
        progress: 1,
        resultJson: result !== undefined ? JSON.stringify(result) : null,
        finishedAt: now(),
      });
    } catch (e) {
      const canceled = abort.signal.aborted || (e instanceof Error && e.name === "CanceledError");
      this.update(job.id, {
        status: canceled ? "canceled" : "failed",
        error: e instanceof Error ? e.message : String(e),
        finishedAt: now(),
      });
    } finally {
      this.running.delete(job.id);
      this.pump();
    }
  }
}

export const jobQueue = new JobQueue();
