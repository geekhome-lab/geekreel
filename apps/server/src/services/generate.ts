import { getAdapter } from "@vw/models";
import type { JobHandler } from "../jobs/queue";
import { resolveEndpoint } from "./models";
import { storeAsset } from "./library";

/**
 * gen.image：文生图任务。
 * payload: { prompt, size?, endpointId?, projectId? }
 * result: { assetId }
 */
export const genImageHandler: JobHandler = async (job, ctx) => {
  const payload = JSON.parse(job.payloadJson) as {
    prompt: string;
    size?: string;
    endpointId?: string;
    projectId?: string;
  };
  if (!payload.prompt?.trim()) throw new Error("缺少提示词");

  ctx.progress(0.05, "解析模型端点");
  const endpoint = resolveEndpoint("image", payload.endpointId);
  if (!endpoint) throw new Error("未配置图片模型端点，请先到「模型」页添加");
  const adapter = getAdapter(endpoint.adapterType);
  if (!adapter?.generateImage) throw new Error(`适配器 ${endpoint.adapterType} 不支持图片生成`);

  ctx.progress(0.15, `调用 ${endpoint.name}`);
  const result = await adapter.generateImage(endpoint.config, {
    prompt: payload.prompt,
    size: payload.size,
    signal: ctx.signal,
  });

  ctx.progress(0.85, "产物入库");
  const title = payload.prompt.replace(/\s+/g, " ").slice(0, 24);
  const asset = storeAsset({
    type: "image",
    title: title || "生成图片",
    ext: "png",
    source: "canvas",
    projectId: payload.projectId ?? job.projectId,
    data: result.data,
  });

  ctx.progress(1, "生成完成");
  return { assetId: asset.id, endpointId: endpoint.id };
};
