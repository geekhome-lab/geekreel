import { Hono } from "hono";
import { getAdapter } from "@vw/models";
import { jobQueue } from "../jobs/queue";
import { err, ok } from "../lib/resp";
import { resolveEndpoint } from "../services/models";

export const genRoutes = new Hono();

/** 同步 LLM 对话（用于意图识别、分镜拆解等轻量调用；长任务走 job） */
genRoutes.post("/chat", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    prompt?: string;
    system?: string;
    endpointId?: string;
  };
  if (!body.prompt?.trim()) return err(c, "缺少 prompt");

  const endpoint = resolveEndpoint("llm", body.endpointId);
  if (!endpoint) return err(c, "未配置文本模型端点，请先到「模型」页添加", 422);
  const adapter = getAdapter(endpoint.adapterType);
  if (!adapter?.chat) return err(c, `适配器 ${endpoint.adapterType} 不支持文本对话`, 500);

  try {
    const text = await adapter.chat(endpoint.config, { prompt: body.prompt, system: body.system });
    return ok(c, { text, endpointId: endpoint.id });
  } catch (e) {
    return err(c, e instanceof Error ? e.message : String(e), 502);
  }
});

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
