/**
 * 每次模型调用记一笔：用量 × 端点单价 = 成本。没填单价也记量，方便以后补价。
 */

import { computeCost, type Capability, type ModelAdapter, type ModelEndpoint } from "@vw/models";
import { db } from "../db";
import { newId, now } from "../lib/resp";

export interface UsageInput {
  endpoint: ModelEndpoint;
  projectId?: string | null;
  jobType: string;
  promptTokens?: number;
  completionTokens?: number;
  images?: number;
  audioChars?: number;
  videoSec?: number;
}

export async function chatMetered(
  adapter: Pick<ModelAdapter, "chat">,
  endpoint: ModelEndpoint,
  req: {
    prompt: string;
    system?: string;
    webSearch?: boolean;
    images?: Array<{ mime: string; data: Uint8Array }>;
  },
  meta: { projectId?: string | null; jobType: string },
): Promise<string> {
  if (!adapter.chat) throw new Error("这个模型不会聊天，换一个文本模型");
  const result = await adapter.chat(endpoint.config, req);
  recordUsage({
    endpoint,
    projectId: meta.projectId,
    jobType: meta.jobType,
    promptTokens: result.usage.promptTokens,
    completionTokens: result.usage.completionTokens,
  });
  return result.text;
}

export function recordUsage(input: UsageInput) {
  const cost = computeCost({
    config: input.endpoint.config,
    promptTokens: input.promptTokens,
    completionTokens: input.completionTokens,
    images: input.images,
    audioChars: input.audioChars,
    videoSec: input.videoSec,
  });
  db.run(
    `INSERT INTO model_usage (id, endpointId, endpointName, capability, projectId, jobType, promptTokens, completionTokens, images, audioChars, videoSec, cost, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId(),
      input.endpoint.id,
      input.endpoint.name,
      input.endpoint.capability,
      input.projectId ?? null,
      input.jobType,
      input.promptTokens ?? 0,
      input.completionTokens ?? 0,
      input.images ?? 0,
      input.audioChars ?? 0,
      input.videoSec ?? 0,
      cost,
      now(),
    ],
  );
}

export interface UsageSummary {
  totalCost: number;
  totalCalls: number;
  promptTokens: number;
  completionTokens: number;
  images: number;
  audioChars: number;
  byEndpoint: Array<{
    endpointId: string;
    name: string;
    capability: Capability;
    calls: number;
    promptTokens: number;
    completionTokens: number;
    images: number;
    audioChars: number;
    cost: number;
  }>;
  byDay: Array<{ date: string; calls: number; cost: number }>;
  recent: Array<{
    id: string;
    endpointName: string;
    capability: string;
    jobType: string;
    cost: number;
    createdAt: number;
  }>;
}

export function usageSummary(days = 30): UsageSummary {
  const since = now() - Math.max(1, days) * 86_400_000;
  const totals = db
    .query(
      `SELECT COUNT(*) AS calls, COALESCE(SUM(cost),0) AS cost,
              COALESCE(SUM(promptTokens),0) AS promptTokens,
              COALESCE(SUM(completionTokens),0) AS completionTokens,
              COALESCE(SUM(images),0) AS images,
              COALESCE(SUM(audioChars),0) AS audioChars
       FROM model_usage WHERE createdAt >= ?`,
    )
    .get(since) as {
    calls: number;
    cost: number;
    promptTokens: number;
    completionTokens: number;
    images: number;
    audioChars: number;
  };

  const byEndpoint = db
    .query(
      `SELECT endpointId, endpointName AS name, capability, COUNT(*) AS calls,
              COALESCE(SUM(promptTokens),0) AS promptTokens,
              COALESCE(SUM(completionTokens),0) AS completionTokens,
              COALESCE(SUM(images),0) AS images,
              COALESCE(SUM(audioChars),0) AS audioChars,
              COALESCE(SUM(cost),0) AS cost
       FROM model_usage WHERE createdAt >= ?
       GROUP BY endpointId, endpointName, capability
       ORDER BY cost DESC, calls DESC`,
    )
    .all(since) as UsageSummary["byEndpoint"];

  const byDay = db
    .query(
      `SELECT strftime('%Y-%m-%d', createdAt / 1000, 'unixepoch', 'localtime') AS date,
              COUNT(*) AS calls, COALESCE(SUM(cost),0) AS cost
       FROM model_usage WHERE createdAt >= ?
       GROUP BY date ORDER BY date ASC`,
    )
    .all(since) as UsageSummary["byDay"];

  const recent = db
    .query(
      `SELECT id, endpointName, capability, jobType, cost, createdAt
       FROM model_usage ORDER BY createdAt DESC LIMIT 20`,
    )
    .all() as UsageSummary["recent"];

  return {
    totalCost: Math.round((totals.cost ?? 0) * 10000) / 10000,
    totalCalls: totals.calls ?? 0,
    promptTokens: totals.promptTokens ?? 0,
    completionTokens: totals.completionTokens ?? 0,
    images: totals.images ?? 0,
    audioChars: totals.audioChars ?? 0,
    byEndpoint,
    byDay,
    recent,
  };
}
