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

export type PushChannelType = "webhook" | "serverchan" | "telegram" | "bark" | "email";

export const pushChannelLabels: Record<PushChannelType, string> = {
  webhook: "Webhook",
  serverchan: "Server酱",
  telegram: "Telegram",
  bark: "Bark",
  email: "邮件",
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

/** 模型经常编造帖子链接。原文一律去该平台搜这条话题。 */
export function topicQuery(title: string): string {
  return title.replace(/#/g, "").replace(/\s+/g, " ").trim() || title.trim();
}

export function topicSearchUrl(platform: string, title: string): string {
  const q = topicQuery(title);
  const enc = encodeURIComponent(q);
  switch (platform.trim()) {
    case "微博": {
      const weiboQ = /#.+#/.test(title) ? title.trim() : q;
      return `https://s.weibo.com/weibo?q=${encodeURIComponent(weiboQ)}`;
    }
    case "抖音":
      return `https://www.douyin.com/search/${enc}`;
    case "B站":
      return `https://search.bilibili.com/all?keyword=${enc}`;
    case "知乎":
      return `https://www.zhihu.com/search?type=content&q=${enc}`;
    case "小红书":
      return `https://www.xiaohongshu.com/search_result?keyword=${enc}`;
    default:
      return `https://www.bing.com/search?q=${encodeURIComponent(`${platform} ${q}`)}`;
  }
}
