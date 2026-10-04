import { NavLink, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { PublicSettings } from "@vw/core";
import { api } from "../lib/api";
import { useAppStore } from "../lib/store";
import { iconAnalyze, iconBox, iconCanvas, iconChat, iconCpu, iconFolder, iconRadar, iconScissors, iconSettings, iconTasks } from "../lib/icons";

const navItems = [
  { to: "/", label: "首页", icon: iconChat },
  { to: "/radar", label: "雷达", icon: iconRadar },
  { to: "/analyze", label: "分析", icon: iconAnalyze },
  { to: "/projects", label: "项目", icon: iconFolder },
  { to: "/canvas", label: "画布", icon: iconCanvas },
  { to: "/timeline", label: "时间线", icon: iconScissors },
  { to: "/assets", label: "资产库", icon: iconBox },
  { to: "/models", label: "模型", icon: iconCpu },
  { to: "/jobs", label: "任务中心", icon: iconTasks },
  { to: "/settings", label: "设置", icon: iconSettings },
];

export function Layout() {
  const wsConnected = useAppStore((s) => s.wsConnected);
  const liveJobs = useAppStore((s) => s.liveJobs);
  const runningCount = Object.values(liveJobs).filter((j) => j.status === "running" || j.status === "queued").length;

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<PublicSettings>("/api/settings"),
    staleTime: 30_000,
  });

  return (
    <div className="flex h-full">
      {/* 侧边栏 */}
      <aside className="flex w-52 shrink-0 flex-col border-r border-line bg-panel">
        <div className="border-b border-line px-4 py-4">
          <div className="text-sm font-semibold tracking-wide">视频工作台</div>
          <div className="mt-0.5 text-[10px] text-fg-faint">Video Workbench</div>
        </div>

        <nav className="flex-1 space-y-0.5 p-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive ? "bg-panel-2 text-accent" : "text-fg-dim hover:bg-panel-2 hover:text-fg"
                }`
              }
            >
              {item.icon({})}
              <span className="flex-1">{item.label}</span>
              {item.to === "/jobs" && runningCount > 0 && (
                <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-black">
                  {runningCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="space-y-2 border-t border-line p-3 text-[10px] text-fg-faint">
          <div className="flex items-center gap-1.5">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${wsConnected ? "bg-emerald-400" : "bg-red-400"}`} />
            {wsConnected ? "已连接" : "连接断开，重连中…"}
          </div>
          {settings && (
            <div className="truncate font-mono" title={`资产库：${settings.libraryRoot}`}>
              {settings.libraryRoot}
            </div>
          )}
        </div>
      </aside>

      {/* 主区域 */}
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
