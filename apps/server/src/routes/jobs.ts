import { Hono } from "hono";
import type { JobStatus } from "@vw/core";
import { jobQueue } from "../jobs/queue";
import { err, ok } from "../lib/resp";

export const jobsRoutes = new Hono();

jobsRoutes.get("/", (c) => {
  const raw = c.req.query("status");
  const page = Math.max(Number(c.req.query("page") ?? 1) || 1, 1);
  const pageSize = Math.min(Math.max(Number(c.req.query("pageSize") ?? 20) || 20, 1), 100);
  const q = c.req.query("q")?.trim();
  const type = c.req.query("type")?.trim();
  let status: JobStatus | JobStatus[] | undefined;
  if (raw === "active") status = ["queued", "running"];
  else if (raw === "queued" || raw === "running" || raw === "done" || raw === "failed" || raw === "canceled") status = raw;
  const { items, total } = jobQueue.queryJobs({
    status,
    q,
    type,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  return ok(c, { items, total, page, pageSize });
});

jobsRoutes.get("/:id", (c) => {
  const job = jobQueue.get(c.req.param("id"));
  if (!job) return err(c, "任务不存在", 404);
  return ok(c, job);
});

jobsRoutes.post("/:id/cancel", (c) => {
  const job = jobQueue.cancel(c.req.param("id"));
  if (!job) return err(c, "任务不存在", 404);
  return ok(c, job);
});

jobsRoutes.post("/:id/retry", (c) => {
  const job = jobQueue.retry(c.req.param("id"));
  if (!job) return err(c, "任务不存在", 404);
  return ok(c, job);
});
