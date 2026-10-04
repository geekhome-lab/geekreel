import { useEffect } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { connectWs, onWsEvent } from "./lib/store";
import { Layout } from "./components/layout";
import { HomePage } from "./pages/homePage";
import { ProjectsPage } from "./pages/projectsPage";
import { AssetsPage } from "./pages/assetsPage";
import { CanvasPage } from "./pages/canvasPage";
import { ModelsPage } from "./pages/modelsPage";
import { JobsPage } from "./pages/jobsPage";
import { SettingsPage } from "./pages/settingsPage";

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
        if (ev.job.type === "asset.index" && ev.job.status === "done") {
          qc.invalidateQueries({ queryKey: ["assets"] });
          qc.invalidateQueries({ queryKey: ["asset-stats"] });
          qc.invalidateQueries({ queryKey: ["asset"] });
        }
      }
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
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/canvas" element={<CanvasPage />} />
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
