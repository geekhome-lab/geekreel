import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Project, Series } from "@vw/core";
import { api, apiJson } from "../lib/api";
import { formatTime } from "../lib/format";
import { useAppStore } from "../lib/store";
import { iconFolder, iconPlus, iconTrash, iconVideo } from "../lib/icons";
import { confirmDanger } from "../lib/prefs";
import { Modal } from "../components/modal";
import { DirPicker } from "../components/dirPicker";

type ProjectsPageData = { items: Project[]; total: number; page: number; pageSize: number; sort: "updated" | "created" };

export function ProjectsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [directory, setDirectory] = useState("");
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<"updated" | "created">("updated");

  const { data, isLoading } = useQuery({
    queryKey: ["projects", page, sort],
    queryFn: () => api<ProjectsPageData>(`/api/projects?page=${page}&pageSize=12&sort=${sort}`),
  });
  const projects = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / (data?.pageSize ?? 12)));
  const { data: seriesList } = useQuery({
    queryKey: ["series"],
    queryFn: () => api<Series[]>("/api/series"),
  });
  const seriesName = (id: string | null) => seriesList?.find((s) => s.id === id)?.name;

  const createMutation = useMutation({
    mutationFn: () => apiJson<Project>("/api/projects", "post", { name, directory }),
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setCreating(false);
      setName("");
      setDirectory("");
      setCurrentProject(project.id);
      navigate("/canvas");
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiJson(`/api/projects/${id}`, "delete"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      if (projects.length <= 1 && page > 1) setPage((p) => p - 1);
    },
  });

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">项目</h1>
          <p className="mt-0.5 text-xs text-fg-faint">一个项目 = 一个本地目录，画布、流水线与成片都放里面</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-line text-xs">
            <button
              className={`px-3 py-1.5 ${sort === "updated" ? "bg-panel-2 text-accent" : "text-fg-dim hover:text-fg"}`}
              onClick={() => {
                setSort("updated");
                setPage(1);
              }}
            >
              最近更新
            </button>
            <button
              className={`px-3 py-1.5 ${sort === "created" ? "bg-panel-2 text-accent" : "text-fg-dim hover:text-fg"}`}
              onClick={() => {
                setSort("created");
                setPage(1);
              }}
            >
              最近创建
            </button>
          </div>
          <button
            className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-black hover:brightness-110"
            onClick={() => setCreating(true)}
          >
            {iconPlus({})} 新建项目
          </button>
        </div>
      </div>

      {seriesList && seriesList.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-xs text-fg-faint">进行中的连载</h2>
          <div className="flex flex-wrap gap-2">
            {seriesList.map((s) => (
              <button
                key={s.id}
                className="rounded-xl border border-line bg-panel px-3 py-2 text-left hover:border-accent-dim"
                onClick={() => {
                  if (s.kind === "drama") navigate(`/drama?series=${s.id}`);
                  else navigate(`/?series=${s.id}&kind=${s.kind}`);
                }}
              >
                <div className="text-sm">{s.name}</div>
                <div className="text-[11px] text-fg-faint">
                  {s.kind === "drama" ? "短剧" : s.kind === "whiteboard" ? "白板" : "自由"} · 已 {s.episodeCount} 集 · 继续
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {isLoading && <div className="text-sm text-fg-faint">加载中…</div>}

      {!isLoading && total === 0 && (
        <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-line text-fg-faint">
          <div className="mb-2 opacity-40">{iconVideo({ width: 36, height: 36 })}</div>
          <div className="text-sm">还没有项目，点击右上角「新建项目」开始</div>
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
        {projects?.map((p) => (
          <div
            key={p.id}
            className="group rounded-xl border border-line bg-panel p-4 transition-colors hover:border-accent-dim"
          >
            <div className="mb-1 flex items-start justify-between">
              <div>
                <div className="truncate text-sm font-medium">{p.name}</div>
                {p.seriesId && (
                  <div className="mt-0.5 text-[11px] text-accent">
                    连载「{seriesName(p.seriesId) ?? "一部"}」{p.episodeIndex ? ` · 第 ${p.episodeIndex} 集` : ""}
                  </div>
                )}
              </div>
              <button
                className="rounded p-1 text-fg-faint opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                title="从列表移除（不删除文件）"
                onClick={() => {
                  if (confirmDanger(`移除项目「${p.name}」？磁盘文件保留。`)) deleteMutation.mutate(p.id);
                }}
              >
                {iconTrash({})}
              </button>
            </div>
            <div className="mb-3 flex items-center gap-1 text-[11px] text-fg-faint">
              {iconFolder({ width: 12, height: 12 })}
              <span className="truncate font-mono" title={p.directory}>{p.directory}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-fg-faint">
                {sort === "created" ? "创建" : "更新"} {formatTime(sort === "created" ? p.createdAt : p.updatedAt)}
              </span>
              <button
                className="rounded-md border border-line px-3 py-1 text-xs text-fg-dim hover:border-accent-dim hover:text-accent"
                onClick={() => {
                  setCurrentProject(p.id);
                  navigate("/canvas");
                }}
              >
                打开
              </button>
            </div>
          </div>
        ))}
      </div>

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2 text-xs">
          <button
            className="rounded-lg border border-line px-3 py-1 text-fg-dim disabled:opacity-40"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            上一页
          </button>
          <span className="text-fg-faint">
            {page} / {pages} · 共 {total} 个
          </span>
          <button
            className="rounded-lg border border-line px-3 py-1 text-fg-dim disabled:opacity-40"
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </button>
        </div>
      )}

      {creating && (
        <Modal title="新建项目" onClose={() => setCreating(false)}>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs text-fg-dim">项目名称</label>
              <input
                autoFocus
                className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent-dim"
                placeholder="例如：武松打虎短剧"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-fg-dim">项目目录</label>
              <div className="flex gap-2">
                <input
                  readOnly
                  className="flex-1 rounded-lg border border-line bg-panel-2 px-3 py-2 font-mono text-xs text-fg-dim outline-none"
                  placeholder="点击右侧按钮选择"
                  value={directory}
                />
                <button
                  className="rounded-lg border border-line px-3 py-2 text-sm text-fg-dim hover:bg-panel-2 hover:text-fg"
                  onClick={() => setPicking(true)}
                >
                  浏览
                </button>
              </div>
              <p className="mt-1 text-[11px] text-fg-faint">会在目录下创建 canvas / pipeline / export 子目录</p>
            </div>
            {error && <div className="text-xs text-red-400">{error}</div>}
            <div className="flex justify-end gap-2">
              <button
                className="rounded-lg border border-line px-4 py-1.5 text-sm text-fg-dim hover:bg-panel-2"
                onClick={() => setCreating(false)}
              >
                取消
              </button>
              <button
                className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-black hover:brightness-110 disabled:opacity-40"
                disabled={!name.trim() || !directory || createMutation.isPending}
                onClick={() => {
                  setError("");
                  createMutation.mutate();
                }}
              >
                {createMutation.isPending ? "创建中…" : "创建"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {picking && (
        <DirPicker
          title="选择项目目录"
          onClose={() => setPicking(false)}
          onSelect={(path) => {
            setDirectory(path);
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}
