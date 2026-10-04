import { jobQueue } from "../jobs/queue";
import { dueSources, getRadarSettings } from "./radar";

/**
 * 每分钟看一眼：到期的观察源拉一次；到点了发早报。
 * 失败不抛到主进程，写进任务中心即可。
 */
let ticking = false;

export function startRadarScheduler(): void {
  const tick = () => {
    if (ticking) return;
    ticking = true;
    try {
      for (const src of dueSources()) {
        const running = jobQueue
          .list({ status: "running" })
          .some((j) => j.type === "radar.fetch" && j.payloadJson.includes(src.id));
        const queued = jobQueue
          .list({ status: "queued" })
          .some((j) => j.type === "radar.fetch" && j.payloadJson.includes(src.id));
        if (running || queued) continue;
        jobQueue.submit("radar.fetch", { sourceId: src.id });
      }

      const settings = getRadarSettings();
      if (settings.digestEnabled) {
        const today = new Date();
        const pad = (n: number) => String(n).padStart(2, "0");
        const date = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
        if (today.getHours() === settings.digestHour && settings.lastDigestDate !== date) {
          const busy = jobQueue
            .list()
            .some((j) => j.type === "radar.digest" && (j.status === "queued" || j.status === "running"));
          if (!busy) jobQueue.submit("radar.digest", {});
        }
      }
    } catch (e) {
      console.error("[radar-scheduler]", e);
    } finally {
      ticking = false;
    }
  };

  setInterval(tick, 60_000);
}
