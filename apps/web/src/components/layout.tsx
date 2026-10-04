import { useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { PublicSettings } from "@vw/core";
import { api, apiJson } from "../lib/api";
import { useT } from "../lib/i18n";
import { usePrefs } from "../lib/prefs";
import { useAppStore } from "../lib/store";
import { BrandMark } from "./brand";
import { iconAnalyze, iconBook, iconBox, iconCanvas, iconChat, iconCpu, iconFolder, iconPalette, iconRadar, iconScissors, iconSeries, iconSettings, iconTasks } from "../lib/icons";

export function Layout() {
  const t = useT();
  const compact = usePrefs((s) => s.compactNav);
  const wsConnected = useAppStore((s) => s.wsConnected);
  const liveJobs = useAppStore((s) => s.liveJobs);
  const runningCount = Object.values(liveJobs).filter((j) => j.status === "running" || j.status === "queued").length;

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<PublicSettings>("/api/settings"),
    staleTime: 30_000,
  });

  const navItems = [
    { to: "/", label: t.nav.home, icon: iconChat },
    { to: "/drama", label: t.nav.drama, icon: iconBook },
    { to: "/series", label: t.nav.series, icon: iconSeries },
    { to: "/radar", label: t.nav.radar, icon: iconRadar },
    { to: "/analyze", label: t.nav.analyze, icon: iconAnalyze },
    { to: "/styles", label: t.nav.styles, icon: iconPalette },
    { to: "/projects", label: t.nav.projects, icon: iconFolder },
    { to: "/canvas", label: t.nav.canvas, icon: iconCanvas },
    { to: "/timeline", label: t.nav.timeline, icon: iconScissors },
    { to: "/assets", label: t.nav.assets, icon: iconBox },
    { to: "/models", label: t.nav.models, icon: iconCpu },
    { to: "/jobs", label: t.nav.jobs, icon: iconTasks },
    { to: "/settings", label: t.nav.settings, icon: iconSettings },
  ];

  return (
    <div className="flex h-full">
      <aside className={`flex shrink-0 flex-col border-r border-line bg-panel ${compact ? "w-[68px]" : "w-52"}`}>
        <div className={`border-b border-line ${compact ? "px-2 py-3" : "px-4 py-4"}`}>
          <BrandMark compact={compact} size={compact ? "sm" : "md"} />
        </div>

        <nav className="flex-1 space-y-0.5 p-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              title={item.label}
              className={({ isActive }) =>
                `relative flex items-center rounded-lg py-2 text-sm transition-colors ${
                  compact ? "justify-center px-2" : "gap-2.5 px-3"
                } ${isActive ? "bg-panel-2 text-accent" : "text-fg-dim hover:bg-panel-2 hover:text-fg"}`
              }
            >
              {item.icon({})}
              {!compact && <span className="flex-1">{item.label}</span>}
              {item.to === "/jobs" && runningCount > 0 && (
                <span className={`rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-black ${compact ? "absolute right-0 top-0" : ""}`}>
                  {runningCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className={`space-y-2 border-t border-line text-[10px] text-fg-faint ${compact ? "p-2" : "p-3"}`}>
          <div className={`flex items-center gap-1.5 ${compact ? "justify-center" : ""}`} title={wsConnected ? t.wsOn : t.wsOff}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${wsConnected ? "bg-emerald-400" : "bg-red-400"}`} />
            {!compact && (wsConnected ? t.wsOn : t.wsOff)}
          </div>
          {settings && !compact && (
            <div className="truncate font-mono" title={settings.libraryRoot}>
              {settings.libraryRoot}
            </div>
          )}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
        <FinishNudge />
      </main>
    </div>
  );
}

function FinishNudge() {
  const navigate = useNavigate();
  const location = useLocation();
  const liveJobs = useAppStore((s) => s.liveJobs);
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);
  const [hide, setHide] = useState("");
  const [busy, setBusy] = useState(false);
  const jobs = useMemo(() => Object.values(liveJobs), [liveJobs]);
  const finish = [...jobs].reverse().find((j) => j.type === "timeline.finish");
  const video = [...jobs].reverse().find((j) => j.type === "gen.video" && j.status === "done");
  const parked = typeof sessionStorage !== "undefined" ? sessionStorage.getItem("vw.needDub") : null;

  let kind: "dubbing" | "ready" | "shot" | null = null;
  let projectId: string | null = null;
  let text = "";
  let hideKey = "";

  if (finish && (finish.status === "queued" || finish.status === "running")) {
    kind = "dubbing";
    projectId = finish.projectId;
    text = finish.message || "正在配音，装进时间线…";
    hideKey = `run:${finish.id}`;
  } else if (finish && finish.status === "done") {
    kind = "ready";
    projectId = finish.projectId;
    text = finish.message || "画面好了，去时间线选音色";
    hideKey = `done:${finish.id}`;
  } else if (video?.projectId || parked) {
    const pid = video?.projectId || parked;
    const hasFinish = jobs.some((j) => j.type === "timeline.finish" && j.projectId === pid);
    if (!hasFinish) {
      kind = "shot";
      projectId = pid;
      text = "出片了。去时间线加字幕、选音色。";
      hideKey = `shot:${pid}`;
    }
  }

  if (!kind || !projectId || hide === hideKey) return null;
  if (location.pathname === "/timeline" && (kind === "shot" || kind === "ready")) return null;

  const go = async () => {
    setCurrentProject(projectId);
    if (kind === "ready" || kind === "dubbing") {
      navigate("/timeline");
      return;
    }
    setBusy(true);
    try {
      await apiJson(`/api/timeline/project/${projectId}/finish`, "post", {
        withSubtitles: usePrefs.getState().autoSubtitles,
        dub: false,
      });
      sessionStorage.removeItem("vw.needDub");
      navigate("/timeline");
    } catch {
      navigate("/canvas");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-40 max-w-sm">
      <div className="pointer-events-auto rounded-xl border border-accent-dim bg-panel/95 p-3 text-xs shadow-xl">
        <div className="mb-1 font-medium text-accent">
          {kind === "shot" ? "出片了" : kind === "dubbing" ? "正在装时间线" : "去选音色"}
        </div>
        <p className="text-fg-dim">{text}</p>
        <div className="mt-2 flex gap-2">
          <button className="rounded-lg bg-accent px-3 py-1 text-black disabled:opacity-50" disabled={busy} onClick={() => void go()}>
            {busy ? "在排队…" : kind === "shot" ? "去时间线" : "去时间线"}
          </button>
          <button className="text-fg-faint underline" onClick={() => setHide(hideKey)}>
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}
