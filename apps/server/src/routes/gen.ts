import { Hono } from "hono";
import { jobQueue } from "../jobs/queue";
import { err, ok } from "../lib/resp";

export const genRoutes = new Hono();

/** 提交文生图任务，返回 job（进度走 WS / 轮询） */
genRoutes.post("/image", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    prompt?: string;
    size?: string;
    endpointId?: string;
    projectId?: string;
  };
  if (!body.prompt?.trim()) return err(c, "缺少提示词");
  const job = jobQueue.submit(
    "gen.image",
    {
      prompt: body.prompt.trim(),
      size: body.size,
      endpointId: body.endpointId,
    },
    body.projectId ?? null,
  );
  return ok(c, job);
});
