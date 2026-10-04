import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  assetKindLabels,
  assetKinds,
  assetSourceLabels,
  assetTypeLabels,
  type Asset,
  type AssetKind,
  type AssetType,
} from "@vw/core";
import { api, apiJson } from "../lib/api";
import { formatBytes, formatDuration, formatTime, monthKey } from "../lib/format";
import { iconAudio, iconImage, iconText, iconTrash, iconUpload, iconVideo } from "../lib/icons";
import { Modal } from "../components/modal";

const typeIcons: Record<AssetType, (size?: number) => React.ReactNode> = {
  image: (s = 28) => iconImage({ width: s, height: s }),
  video: (s = 28) => iconVideo({ width: s, height: s }),
  audio: (s = 28) => iconAudio({ width: s, height: s }),
  text: (s = 28) => iconText({ width: s, height: s }),
};

const tabs: Array<{ key: string; label: string }> = [
  { key: "", label: "全部" },
  { key: "image", label: "图片" },
  { key: "video", label: "视频" },
  { key: "audio", label: "音频" },
  { key: "text", label: "文本" },
];

export function AssetsPage() {
  const queryClient = useQueryClient();
  const [type, setType] = useState("");
  const [kind, setKind] = useState("");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [q, setQ] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [picked, setPicked] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (kind) params.set("kind", kind);
    if (favoriteOnly) params.set("favorite", "1");
    if (q.trim()) params.set("q", q.trim());
    const s = params.toString();
    return s ? `?${s}` : "";
  }, [type, kind, favoriteOnly, q]);

  const { data: assets } = useQuery({
    queryKey: ["assets", type, kind, favoriteOnly, q],
    queryFn: () => api<Asset[]>(`/api/assets${queryString}`),
  });

  const { data: stats } = useQuery({
    queryKey: ["asset-stats"],
    queryFn: () =>
      api<{
        byType: Array<{ type: AssetType; count: number; bytes: number }>;
        total: number;
        big?: Array<{ id: string; title: string; type: AssetType; sizeBytes: number }>;
      }>("/api/assets/stats"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiJson(`/api/assets/${id}`, "delete"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      queryClient.invalidateQueries({ queryKey: ["asset-stats"] });
      setPreviewId(null);
    },
  });

  const upload = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    try {
      const form = new FormData();
      for (const f of list) form.append("files", f);
      await api<{ imported: Asset[]; skipped: string[] }>("/api/assets/import", { method: "POST", body: form });
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      queryClient.invalidateQueries({ queryKey: ["asset-stats"] });
    } finally {
      setUploading(false);
    }
  };

  // 按月份分组（与资产库目录结构一致）
  const groups = useMemo(() => {
    const map = new Map<string, Asset[]>();
    for (const a of assets ?? []) {
      const key = monthKey(a.createdAt);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [assets]);

  const totalBytes = stats?.byType.reduce((sum, t) => sum + t.bytes, 0) ?? 0;

  return (
    <div
      className="relative min-h-full p-6"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        upload(e.dataTransfer.files);
      }}
    >
      {/* 头部 */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">资产库</h1>
          <p className="mt-0.5 text-xs text-fg-faint">
            共 {stats?.total ?? 0} 个资产 · {formatBytes(totalBytes)} · 按 类型/年月/日期_标题 自动分类落盘
          </p>
        </div>
        <button
          className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-black hover:brightness-110 disabled:opacity-40"
          disabled={uploading}
          onClick={() => fileInput.current?.click()}
        >
          {iconUpload({})} {uploading ? "上传中…" : "导入文件"}
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) upload(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {/* 类型 Tab + 搜索 */}
      <div className="mb-5 flex items-center gap-3">
        <div className="flex rounded-lg border border-line bg-panel p-0.5">
          {tabs.map((t) => (
            <button
              key={t.key}
              className={`rounded-md px-3.5 py-1.5 text-xs transition-colors ${
                type === t.key ? "bg-panel-2 text-accent" : "text-fg-dim hover:text-fg"
              }`}
              onClick={() => setType(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <select
          className="rounded-lg border border-line bg-panel px-2 py-1.5 text-xs"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="">全部用途</option>
          {assetKinds.map((k) => (
            <option key={k} value={k}>{assetKindLabels[k]}</option>
          ))}
        </select>
        <button
          className={`rounded-lg border px-3 py-1.5 text-xs ${favoriteOnly ? "border-accent bg-accent/15 text-accent" : "border-line text-fg-dim"}`}
          onClick={() => setFavoriteOnly((v) => !v)}
        >
          只看收藏
        </button>
        <input
          className="w-64 rounded-lg border border-line bg-panel px-3 py-1.5 text-xs outline-none placeholder:text-fg-faint focus:border-accent-dim"
          placeholder="搜索标题或标签…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="ml-auto flex gap-1">
          <button
            className={`rounded-lg border px-2.5 py-1.5 text-xs ${view === "grid" ? "border-accent text-accent" : "border-line text-fg-dim"}`}
            onClick={() => setView("grid")}
          >
            网格
          </button>
          <button
            className={`rounded-lg border px-2.5 py-1.5 text-xs ${view === "list" ? "border-accent text-accent" : "border-line text-fg-dim"}`}
            onClick={() => setView("list")}
          >
            列表
          </button>
          <button
            className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-fg-dim"
            onClick={async () => {
              await apiJson("/api/assets/cache/clear", "post");
              queryClient.invalidateQueries({ queryKey: ["asset-stats"] });
            }}
          >
            清缓存
          </button>
        </div>
      </div>
      {picked.length > 0 && (
        <div className="mb-3 flex items-center gap-2 text-xs">
          <span className="text-fg-faint">已勾 {picked.length} 条</span>
          <button
            className="rounded-lg border border-red-900/50 px-2 py-1 text-red-400"
            onClick={async () => {
              if (!confirm(`删掉勾上的 ${picked.length} 条？画布还在用的会跳过。`)) return;
              await apiJson("/api/assets/batch", "post", { ids: picked, action: "delete" });
              setPicked([]);
              queryClient.invalidateQueries({ queryKey: ["assets"] });
              queryClient.invalidateQueries({ queryKey: ["asset-stats"] });
            }}
          >
            批量删除
          </button>
          <button className="text-fg-faint underline" onClick={() => setPicked([])}>取消勾选</button>
        </div>
      )}
      {stats?.big && stats.big.length > 0 && (
        <p className="mb-3 text-[10px] text-fg-faint">
          大文件：{stats.big.slice(0, 3).map((b) => `${b.title} ${formatBytes(b.sizeBytes)}`).join(" · ")}
        </p>
      )}

      {/* 分组网格 */}
      {groups.length === 0 && (
        <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-line text-fg-faint">
          <div className="mb-2 opacity-40">{iconBox36}</div>
          <div className="text-sm">还没有资产，拖文件到这里或点「导入文件」</div>
        </div>
      )}

      {groups.map(([month, items]) => (
        <section key={month} className="mb-7">
          <h2 className="mb-3 text-xs font-medium text-fg-faint">
            {month} <span className="ml-1 text-fg-faint/60">({items.length})</span>
          </h2>
          {view === "grid" ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
              {items.map((a) => (
                <div key={a.id} className="relative">
                  <label className="absolute top-2 left-2 z-10">
                    <input
                      type="checkbox"
                      className="accent-amber-400"
                      checked={picked.includes(a.id)}
                      onChange={() => setPicked((xs) => (xs.includes(a.id) ? xs.filter((x) => x !== a.id) : [...xs, a.id]))}
                    />
                  </label>
                  <AssetCard asset={a} onClick={() => setPreviewId(a.id)} />
                </div>
              ))}
            </div>
          ) : (
            <div className="divide-y divide-line rounded-xl border border-line bg-panel">
              {items.map((a) => (
                <div key={a.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                  <input
                    type="checkbox"
                    className="accent-amber-400"
                    checked={picked.includes(a.id)}
                    onChange={() => setPicked((xs) => (xs.includes(a.id) ? xs.filter((x) => x !== a.id) : [...xs, a.id]))}
                  />
                  <button className="min-w-0 flex-1 truncate text-left hover:text-accent" onClick={() => setPreviewId(a.id)}>
                    {a.title}
                  </button>
                  <span className="text-fg-faint">{assetTypeLabels[a.type]}</span>
                  <span className="text-fg-faint">{formatBytes(a.sizeBytes)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      ))}

      {/* 拖拽遮罩 */}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-accent/10 backdrop-blur-[2px]">
          <div className="rounded-xl border-2 border-dashed border-accent bg-panel px-8 py-6 text-sm text-accent">
            松开以导入文件
          </div>
        </div>
      )}

      {previewId && (
        <AssetPreview
          id={previewId}
          onClose={() => setPreviewId(null)}
          onDelete={(id) => deleteMutation.mutate(id)}
        />
      )}
    </div>
  );
}

const iconBox36 = (
  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
    <path d="m3.3 7 8.7 5 8.7-5" />
    <path d="M12 22V12" />
  </svg>
);

// ---------------------------------------------------------------------------
// 资产卡片
// ---------------------------------------------------------------------------

function AssetCard(props: { asset: Asset; onClick: () => void }) {
  const { asset: a } = props;
  return (
    <button
      className="group overflow-hidden rounded-xl border border-line bg-panel text-left transition-colors hover:border-accent-dim"
      onClick={props.onClick}
    >
      <div className="flex h-28 items-center justify-center bg-panel-2 text-fg-faint">
        {a.thumbPath ? (
          <img
            className="h-full w-full object-cover"
            src={`/api/assets/${a.id}/file?variant=thumb`}
            alt={a.title}
            loading="lazy"
          />
        ) : (
          typeIcons[a.type]()
        )}
      </div>
      <div className="p-2.5">
        <div className="flex items-center gap-1">
          <div className="truncate text-xs font-medium" title={a.title}>{a.title}</div>
          {a.favorite && <span className="text-[10px] text-accent">★</span>}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-fg-faint">
          <span className="rounded bg-panel-2 px-1 py-0.5">{assetTypeLabels[a.type]}</span>
          {a.kind && a.kind !== "generic" && <span>{assetKindLabels[a.kind]}</span>}
          {a.durationMs !== null && <span>{formatDuration(a.durationMs)}</span>}
          <span>{formatBytes(a.sizeBytes)}</span>
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// 预览弹窗
// ---------------------------------------------------------------------------

function AssetPreview(props: { id: string; onClose: () => void; onDelete: (id: string) => void }) {
  const queryClient = useQueryClient();
  const [editingTitle, setEditingTitle] = useState<string | null>(null);

  const { data: asset } = useQuery({
    queryKey: ["asset", props.id],
    queryFn: () => api<Asset>(`/api/assets/${props.id}`),
  });

  const renameMutation = useMutation({
    mutationFn: (title: string) => apiJson<Asset>(`/api/assets/${props.id}`, "patch", { title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      queryClient.invalidateQueries({ queryKey: ["asset", props.id] });
      setEditingTitle(null);
    },
  });

  if (!asset) return null;
  const fileUrl = (variant: string) => `/api/assets/${asset.id}/file?variant=${variant}`;

  return (
    <Modal title="" onClose={props.onClose} width="w-[760px]">
      <div className="space-y-4">
        {/* 预览区 */}
        <div className="flex max-h-[46vh] items-center justify-center overflow-hidden rounded-lg bg-black/40">
          {asset.type === "video" && (
            <video
              className="max-h-[46vh] w-full"
              controls
              src={asset.proxyPath ? fileUrl("proxy") : fileUrl("original")}
            />
          )}
          {asset.type === "image" && (
            <img className="max-h-[46vh] object-contain" src={fileUrl("original")} alt={asset.title} />
          )}
          {asset.type === "audio" && (
            <div className="w-full p-6">
              {asset.thumbPath && <img className="mb-4 w-full rounded" src={fileUrl("thumb")} alt="波形" />}
              <audio className="w-full" controls src={fileUrl("original")} />
            </div>
          )}
          {asset.type === "text" && <TextPreview url={fileUrl("original")} />}
        </div>

        {/* 标题（点击可改） */}
        <div>
          {editingTitle === null ? (
            <button
              className="text-sm font-medium hover:text-accent"
              title="点击重命名"
              onClick={() => setEditingTitle(asset.title)}
            >
              {asset.title}
            </button>
          ) : (
            <div className="flex gap-2">
              <input
                autoFocus
                className="flex-1 rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-sm outline-none focus:border-accent-dim"
                value={editingTitle}
                onChange={(e) => setEditingTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && editingTitle.trim()) renameMutation.mutate(editingTitle.trim());
                  if (e.key === "Escape") setEditingTitle(null);
                }}
              />
              <button
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-black disabled:opacity-40"
                disabled={!editingTitle.trim() || renameMutation.isPending}
                onClick={() => renameMutation.mutate(editingTitle.trim())}
              >
                保存
              </button>
            </div>
          )}
          <div className="mt-1 font-mono text-[11px] text-fg-faint">{asset.path}</div>
        </div>

        {/* 元数据 */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg border border-line bg-panel-2 p-3 text-xs sm:grid-cols-3">
          <MetaItem label="类型" value={assetTypeLabels[asset.type]} />
          <MetaItem label="来源" value={assetSourceLabels[asset.source]} />
          <MetaItem label="大小" value={formatBytes(asset.sizeBytes)} />
          {asset.durationMs !== null && <MetaItem label="时长" value={formatDuration(asset.durationMs)} />}
          {asset.width && asset.height && <MetaItem label="分辨率" value={`${asset.width}×${asset.height}`} />}
          <MetaItem label="入库时间" value={formatTime(asset.createdAt)} />
        </div>
        <AssetMetaEditor asset={asset} />

        {/* 操作 */}
        <div className="flex justify-between">
          <div className="flex gap-2">
            <a
              className="rounded-lg border border-line px-4 py-1.5 text-sm text-fg-dim hover:bg-panel-2 hover:text-fg"
              href={fileUrl("original")}
              download={asset.name}
            >
              下载
            </a>
            <button
              className="rounded-lg border border-line px-4 py-1.5 text-sm text-fg-dim hover:text-fg"
              onClick={() => void apiJson(`/api/assets/${asset.id}/reveal`, "post")}
            >
              在文件夹中显示
            </button>
          </div>
          <button
            className="flex items-center gap-1.5 rounded-lg border border-red-900/50 px-4 py-1.5 text-sm text-red-400 hover:bg-red-950/40"
            onClick={() => {
              if (confirm(`删除资产「${asset.title}」？文件将一并删除。`)) props.onDelete(asset.id);
            }}
          >
            {iconTrash({})} 删除
          </button>
        </div>
      </div>
    </Modal>
  );
}

function AssetMetaEditor(props: { asset: Asset }) {
  const qc = useQueryClient();
  const [tagDraft, setTagDraft] = useState("");
  const patch = (body: { favorite?: boolean; kind?: AssetKind; tags?: string[] }) =>
    apiJson<Asset>(`/api/assets/${props.asset.id}`, "patch", body).then(() => {
      qc.invalidateQueries({ queryKey: ["assets"] });
      qc.invalidateQueries({ queryKey: ["asset", props.asset.id] });
    });

  return (
    <div className="space-y-2 rounded-lg border border-line bg-panel-2 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <button
          className={`rounded-lg border px-2.5 py-1 ${props.asset.favorite ? "border-accent text-accent" : "border-line text-fg-dim"}`}
          onClick={() => void patch({ favorite: !props.asset.favorite })}
        >
          {props.asset.favorite ? "已收藏" : "收藏"}
        </button>
        <select
          className="rounded-lg border border-line bg-panel px-2 py-1"
          value={props.asset.kind ?? "generic"}
          onChange={(e) => void patch({ kind: e.target.value as AssetKind })}
        >
          {assetKinds.map((k) => (
            <option key={k} value={k}>{assetKindLabels[k]}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap gap-1">
        {(props.asset.tags ?? []).map((t) => (
          <button
            key={t}
            className="rounded-full border border-line px-2 py-0.5 text-fg-dim hover:border-red-400"
            title="点一下去掉"
            onClick={() => void patch({ tags: (props.asset.tags ?? []).filter((x) => x !== t) })}
          >
            {t}
          </button>
        ))}
        <input
          className="w-28 rounded-lg border border-line bg-panel px-2 py-0.5 outline-none"
          placeholder="加标签回车"
          value={tagDraft}
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && tagDraft.trim()) {
              void patch({ tags: [...(props.asset.tags ?? []), tagDraft.trim()] });
              setTagDraft("");
            }
          }}
        />
      </div>
    </div>
  );
}

function MetaItem(props: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-fg-faint">{props.label}</span>
      <span className="truncate text-fg-dim">{props.value}</span>
    </div>
  );
}

function TextPreview(props: { url: string }) {
  const { data } = useQuery({
    queryKey: ["asset-text", props.url],
    queryFn: async () => {
      const res = await fetch(props.url);
      return res.text();
    },
  });
  return (
    <pre className="max-h-[46vh] w-full overflow-y-auto p-5 font-mono text-xs leading-relaxed whitespace-pre-wrap text-fg-dim">
      {data ?? "加载中…"}
    </pre>
  );
}
