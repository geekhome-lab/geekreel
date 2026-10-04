/**
 * 热点雷达 + 推送：前后端共享类型。
 * 热度为 AI 估计（0–100），UI 必须标注。
 */

export type RadarSourceKind = "ai-query" | "rss" | "http-api";

export interface RadarSource {
  id: string;
  name: string;
  kind: RadarSourceKind;
  platform: string;
  queryTemplate: string;
  intervalMinutes: number;
  endpointId: string | null;
  enabled: boolean;
  lastRunAt: number | null;
  lastError: string | null;
  createdAt: number;
}

export interface RadarItem {
  id: string;
  sourceId: string;
  title: string;
  platform: string;
  url: string | null;
  /** 0–100，AI 估计 */
  heat: number;
  heatText: string;
  summary: string;
  hash: string;
  fetchedAt: number;
}

export interface RadarSub {
  id: string;
  keyword: string;
  /** 空数组 = 不限平台 */
  platforms: string[];
  heatThreshold: number;
  /** 免打扰开始小时 0–23；与 quietEnd 组成区间，可跨夜 */
  quietStart: number | null;
  quietEnd: number | null;
  channelIds: string[];
  enabled: boolean;
  createdAt: number;
}

export type PushChannelType = "webhook" | "serverchan" | "telegram" | "bark";

export const pushChannelLabels: Record<PushChannelType, string> = {
  webhook: "Webhook",
  serverchan: "Server酱",
  telegram: "Telegram",
  bark: "Bark",
};

export interface PushChannel {
  id: string;
  type: PushChannelType;
  name: string;
  config: Record<string, string>;
  enabled: boolean;
  createdAt: number;
}

export interface PushLog {
  id: string;
  subId: string | null;
  channelId: string;
  title: string;
  status: "sent" | "failed";
  error: string | null;
  createdAt: number;
}

export interface RadarSettings {
  digestEnabled: boolean;
  digestHour: number;
  lastDigestDate: string | null;
}

export const intervalPresets: Array<{ minutes: number; label: string }> = [
  { minutes: 30, label: "每半小时" },
  { minutes: 60, label: "每小时" },
  { minutes: 360, label: "每 6 小时" },
  { minutes: 1440, label: "每天一次" },
];
