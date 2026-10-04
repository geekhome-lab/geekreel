import { useEffect } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { connectWs, onWsEvent } from "./lib/store";
import { Layout } from "./components/layout";
import { HomePage } from "./pages/homePage";
import { ProjectsPage } from "./pages/projectsPage";
import { AssetsPage } from "./pages/assetsPage";
import { CanvasPage } from "./pages/canvasPage";
import { TimelinePage } from "./pages/timelinePage";
import { ModelsPage } from "./pages/modelsPage";
import { JobsPage } from "./pages/jobsPage";
import { SettingsPage } from "./pages/settingsPage";
import { RadarPage } from "./pages/radarPage";
import { AnalyzePage } from "./pages/analyzePage";
import { StylesPage } from "./pages/stylesPage";
import { DramaPage } from "./pages/dramaPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

/** WS 事件 → 查询失效联动 */
function WsBridge() {
  const qc = useQueryClient();
  useEffect(() => {
    connectWs();
    return onWsEvent((ev) => {
      if (ev.type === "asset.upsert" || ev.type === "asset.remove") {
        qc.invalidateQueries({ queryKey: ["assets"] });
        qc.invalidateQueries({ queryKey: ["asset-stats"] });
      }
      if (ev.type === "job.upsert") {
        qc.invalidateQueries({ queryKey: ["jobs"] });
        if (ev.job.status === "done") qc.invalidateQueries({ queryKey: ["model-usage"] });
        if (ev.job.type === "asset.migrate" && ev.job.status === "done") qc.invalidateQueries({ queryKey: ["settings"] });
        if (ev.job.type === "asset.index" && ev.job.status === "done") {
          qc.invalidateQueries({ queryKey: ["assets"] });
          qc.invalidateQueries({ queryKey: ["asset-stats"] });
          qc.invalidateQueries({ queryKey: ["asset"] });
        }
        if ((ev.job.type.startsWith("radar.") || ev.job.type === "analyze.run" || ev.job.type === "remake.run" || ev.job.type === "pipeline.run" || ev.job.type === "style.import") && (ev.job.status === "done" || ev.job.status === "failed")) {
          qc.invalidateQueries({ queryKey: ["radar-board"] });
          qc.invalidateQueries({ queryKey: ["radar-sources"] });
          qc.invalidateQueries({ queryKey: ["radar-status"] });
          qc.invalidateQueries({ queryKey: ["analyze-reports"] });
          qc.invalidateQueries({ queryKey: ["styles"] });
          qc.invalidateQueries({ queryKey: ["projects"] });
          qc.invalidateQueries({ queryKey: ["series"] });
        }
      }
      if (ev.type === "radar.upsert") qc.invalidateQueries({ queryKey: ["radar-board"] });
      if (ev.type === "push.log") qc.invalidateQueries({ queryKey: ["push-logs"] });
    });
  }, [qc]);
  return null;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <WsBridge />
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="/drama" element={<DramaPage />} />
            <Route path="/radar" element={<RadarPage />} />
            <Route path="/analyze" element={<AnalyzePage />} />
            <Route path="/styles" element={<StylesPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/canvas" element={<CanvasPage />} />
            <Route path="/timeline" element={<TimelinePage />} />
            <Route path="/assets" element={<AssetsPage />} />
            <Route path="/models" element={<ModelsPage />} />
            <Route path="/jobs" element={<JobsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
