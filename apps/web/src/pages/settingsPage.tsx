import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PublicSettings } from "@vw/core";
import { api, apiJson } from "../lib/api";
import { iconFolder } from "../lib/icons";
import { DirPicker } from "../components/dirPicker";

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<PublicSettings>("/api/settings"),
  });

  const saveMutation = useMutation({
    mutationFn: (libraryRoot: string) => apiJson<PublicSettings>("/api/settings", "put", { libraryRoot }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      if (data.assetCount > 0) {
        setMessage("已更新资产库目录。注意：已有资产文件仍在原目录，请手动迁移后重新导入（自动迁移将在后续版本提供）。");
      } else {
        setMessage("已更新资产库目录。");
      }
      setError("");
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : String(e));
      setMessage("");
    },
  });

  return (
    <div className="max-w-2xl p-6">
      <div className="mb-6">
        <h1 className="text-lg font-semibold">设置</h1>
        <p className="mt-0.5 text-xs text-fg-faint">全局配置，更多选项（模型端点、推送渠道）将在后续里程碑加入</p>
      </div>

      <div className="space-y-4">
        {/* 资产库 */}
        <section className="rounded-xl border border-line bg-panel p-5">
          <h2 className="mb-1 text-sm font-medium">资产库目录</h2>
          <p className="mb-3 text-xs text-fg-faint">
            所有图片 / 视频 / 音频 / 文本资产统一存放在这里，按「类型 / 年月 / 日期_标题」自动分类。
          </p>
          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center gap-2 rounded-lg border border-line bg-panel-2 px-3 py-2">
              <span className="text-accent">{iconFolder({})}</span>
              <span className="truncate font-mono text-xs">{settings?.libraryRoot ?? "…"}</span>
            </div>
            <button
              className="rounded-lg border border-line px-4 py-2 text-sm text-fg-dim hover:bg-panel-2 hover:text-fg"
              onClick={() => setPicking(true)}
            >
              更改
            </button>
          </div>
          {message && <p className="mt-2 text-xs text-amber-400">{message}</p>}
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        </section>

        {/* 媒体能力 */}
        <section className="rounded-xl border border-line bg-panel p-5">
          <h2 className="mb-1 text-sm font-medium">媒体处理（ffmpeg）</h2>
          <p className="mb-3 text-xs text-fg-faint">用于元数据探测、缩略图、视频代理与转码。</p>
          {settings?.ffmpeg.available ? (
            <div className="space-y-1 text-xs">
              <div className="flex justify-between rounded bg-panel-2 px-3 py-1.5">
                <span className="text-fg-faint">ffmpeg</span>
                <span className="font-mono text-fg-dim">{settings.ffmpeg.ffmpeg}</span>
              </div>
              <div className="flex justify-between rounded bg-panel-2 px-3 py-1.5">
                <span className="text-fg-faint">ffprobe</span>
                <span className="font-mono text-fg-dim">{settings.ffmpeg.ffprobe ?? "未找到"}</span>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-900/50 bg-amber-950/30 p-3 text-xs text-amber-300">
              <p className="mb-1 font-medium">未检测到 ffmpeg / ffprobe</p>
              <p className="text-amber-400/80">
                资产仍可正常导入与管理，但不会生成缩略图和代理。安装后重启 server 生效：
              </p>
              <code className="mt-2 block rounded bg-black/40 px-2 py-1.5 font-mono text-[11px]">
                brew install ffmpeg
              </code>
            </div>
          )}
        </section>

        {/* 关于 */}
        <section className="rounded-xl border border-line bg-panel p-5">
          <h2 className="mb-3 text-sm font-medium">关于</h2>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between rounded bg-panel-2 px-3 py-1.5">
              <span className="text-fg-faint">版本</span>
              <span className="font-mono text-fg-dim">v{settings?.version}</span>
            </div>
            <div className="flex justify-between rounded bg-panel-2 px-3 py-1.5">
              <span className="text-fg-faint">数据目录</span>
              <span className="font-mono text-fg-dim">{settings?.dataDir}</span>
            </div>
            <div className="flex justify-between rounded bg-panel-2 px-3 py-1.5">
              <span className="text-fg-faint">资产总数</span>
              <span className="font-mono text-fg-dim">{settings?.assetCount}</span>
            </div>
          </div>
        </section>
      </div>

      {picking && settings && (
        <DirPicker
          title="选择资产库目录"
          initialPath={settings.libraryRoot}
          onClose={() => setPicking(false)}
          onSelect={(path) => {
            setPicking(false);
            saveMutation.mutate(path);
          }}
        />
      )}
    </div>
  );
}
