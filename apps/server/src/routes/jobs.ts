import { Hono } from "hono";
import type { JobStatus } from "@vw/core";
import { jobQueue } from "../jobs/queue";
import { err, ok } from "../lib/resp";

export const jobsRoutes = new Hono();

jobsRoutes.get("/", (c) => {
  const status = c.req.query("status") as JobStatus | undefined;
  return ok(c, jobQueue.list({ status }));
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
