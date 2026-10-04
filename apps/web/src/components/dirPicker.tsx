import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, apiJson } from "../lib/api";
import { iconFolder, iconPlus } from "../lib/icons";
import { Modal } from "./modal";

interface BrowseResult {
  path: string;
  parent: string;
  isRoot: boolean;
  dirs: Array<{ name: string; path: string }>;
}

/** 本机目录选择器（服务器侧目录，浏览器无法直接选） */
export function DirPicker(props: {
  title?: string;
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState(props.initialPath ?? "");
  const [newFolder, setNewFolder] = useState("");
  const [error, setError] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["fs-browse", current],
    queryFn: () => api<BrowseResult>(`/api/fs/browse${current ? `?path=${encodeURIComponent(current)}` : ""}`),
  });

  const mkdir = async () => {
    if (!newFolder.trim() || !data) return;
    setError("");
    try {
      const res = await apiJson<{ path: string }>("/api/fs/mkdir", "post", { path: data.path, name: newFolder.trim() });
      setNewFolder("");
      setCurrent(res.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Modal title={props.title ?? "选择文件夹"} onClose={props.onClose}>
      <div className="space-y-3">
        {/* 面包屑 */}
        <div className="flex items-center gap-1.5 rounded-lg border border-line bg-panel-2 px-3 py-2 text-xs text-fg-dim">
          <button
            className="shrink-0 rounded px-1.5 py-0.5 hover:bg-line disabled:opacity-30"
            disabled={!data || data.isRoot}
            onClick={() => data && setCurrent(data.parent)}
          >
            上级
          </button>
          <span className="truncate font-mono" title={data?.path}>
            {data?.path ?? "…"}
          </span>
        </div>

        {/* 目录列表 */}
        <div className="h-64 overflow-y-auto rounded-lg border border-line">
          {isLoading && <div className="p-4 text-xs text-fg-faint">加载中…</div>}
          {data && data.dirs.length === 0 && (
            <div className="p-4 text-xs text-fg-faint">此目录下没有子文件夹</div>
          )}
          {data?.dirs.map((d) => (
            <button
              key={d.path}
              className="flex w-full items-center gap-2 border-b border-line/50 px-3 py-2 text-left text-sm last:border-0 hover:bg-panel-2"
              onDoubleClick={() => setCurrent(d.path)}
              onClick={() => setCurrent(d.path)}
            >
              <span className="text-accent">{iconFolder({})}</span>
              <span className="truncate">{d.name}</span>
            </button>
          ))}
        </div>

        {/* 新建文件夹 */}
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-sm outline-none placeholder:text-fg-faint focus:border-accent-dim"
            placeholder="新建文件夹名称"
            value={newFolder}
            onChange={(e) => setNewFolder(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && mkdir()}
          />
          <button
            className="flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-sm text-fg-dim hover:bg-panel-2 hover:text-fg"
            onClick={mkdir}
          >
            {iconPlus({})} 新建
          </button>
        </div>

        {error && <div className="text-xs text-red-400">{error}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            className="rounded-lg border border-line px-4 py-1.5 text-sm text-fg-dim hover:bg-panel-2 hover:text-fg"
            onClick={props.onClose}
          >
            取消
          </button>
          <button
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-black hover:brightness-110 disabled:opacity-40"
            disabled={!data}
            onClick={() => data && props.onSelect(data.path)}
          >
            选择此目录
          </button>
        </div>
      </div>
    </Modal>
  );
}
