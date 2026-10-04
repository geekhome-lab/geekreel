import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { Job, StylePackPublic } from "@vw/core";
import type { Capability, ModelEndpoint } from "@vw/models";
import { api, apiJson } from "../lib/api";
import { useAppStore } from "../lib/store";
import { waitForJob } from "../lib/runGen";
import { iconPlay } from "../lib/icons";

export function StylesPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);
  const setPendingAutoRun = useAppStore((s) => s.setPendingAutoRun);

  const { data: packs, refetch } = useQuery({
    queryKey: ["styles"],
    queryFn: () => api<StylePackPublic[]>("/api/styles"),
  });
  const { data: endpoints } = useQuery({
    queryKey: ["model-endpoints"],
    queryFn: () => api<ModelEndpoint[]>("/api/models/endpoints"),
  });

  const [activeId, setActiveId] = useState(params.get("pack") ?? "smy-animation");
  const pack = packs?.find((p) => p.id === activeId) ?? packs?.[0] ?? null;
  const [substyle, setSubstyle] = useState("");
  const [story, setStory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const chosenSub = substyle || pack?.defaultSubstyle || "";

  const missing = useMemo(() => {
    if (!pack) return [] as string[];
    const have = new Set((endpoints ?? []).filter((e) => e.enabled).map((e) => e.capability as Capability));
    return pack.requiredCapabilities.filter((c) => !have.has(c));
  }, [pack, endpoints]);

  const start = async () => {
    if (!pack || !story.trim() || busy) return;
    if (!pack.ready) {
      setError(pack.unavailableReason || "这套风格还不能用");
      return;
    }
    if (missing.length) {
      setError("还缺模型：" + missing.join("、") + "。到「模型」页加上再来。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const job = await apiJson<Job>("/api/pipelines/run", "post", {
        story: story.trim(),
        packId: pack.id,
        substyle: chosenSub || undefined,
      });
      const done = await waitForJob(job.id, 8 * 60_000);
      const result = JSON.parse(done.resultJson ?? "{}") as { projectId?: string };
      if (!result.projectId) throw new Error("没有建出项目");
      setCurrentProject(result.projectId);
      setPendingAutoRun(true);
      navigate("/canvas");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex h-full max-w-6xl gap-6 p-6">
      <div className="w-[300px] shrink-0">
        <h1 className="text-lg font-semibold">风格中心</h1>
        <p className="mt-0.5 mb-4 text-xs text-fg-faint">
          选一套风格，写一句故事，自动拆 5 集并搭好画布。新风格只要丢进项目的 stylePacks/ 文件夹。
        </p>
        <button className="mb-3 text-[11px] text-fg-faint underline hover:text-fg" onClick={() => refetch()}>
          重新扫描
        </button>
        <div className="space-y-2">
          {packs?.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setActiveId(p.id);
                setSubstyle(p.defaultSubstyle ?? "");
              }}
              className={`w-full overflow-hidden rounded-xl border text-left ${
                pack?.id === p.id ? "border-accent bg-panel-2" : "border-line bg-panel hover:border-accent-dim"
              }`}
            >
              <PackCover pack={p} />
              <div className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{p.name}</span>
                  {!p.ready && <span className="text-[10px] text-fg-faint">未开放</span>}
                </div>
                <p className="mt-0.5 line-clamp-2 text-[11px] text-fg-faint">{p.summary}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto">
        {!pack && <p className="text-sm text-fg-faint">还没有风格包。把目录放到项目根下的 stylePacks/。</p>}
        {pack && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">{pack.name}</h2>
              <p className="mt-1 text-sm text-fg-dim">{pack.summary}</p>
              <p className="mt-2 text-[11px] text-fg-faint">
                需要：{pack.requiredCapabilities.join("、")} · 版本 {pack.version}
              </p>
            </div>

            {!pack.ready && (
              <div className="rounded-xl border border-amber-900/50 bg-amber-950/30 px-4 py-3 text-xs text-amber-200">
                {pack.unavailableReason}
              </div>
            )}

            {pack.substyles.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs text-fg-faint">子风格（一剧只用一个）</h3>
                <div className="flex flex-wrap gap-1.5">
                  {pack.substyles.map((s) => (
                    <button
                      key={s.id}
                      className={`rounded-full px-3 py-1 text-xs ${
                        chosenSub === s.id ? "bg-accent text-black" : "border border-line text-fg-dim hover:text-fg"
                      }`}
                      onClick={() => setSubstyle(s.id)}
                      title={s.hint}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <textarea
              rows={5}
              className="w-full resize-none rounded-xl border border-line bg-panel p-3 text-sm outline-none focus:border-accent-dim"
              placeholder="写一句故事，或贴一段小说。例如：武松在景阳冈打虎。"
              value={story}
              onChange={(e) => setStory(e.target.value)}
            />
            {error && (
              <div className="rounded-xl border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
                {error}{" "}
                {missing.length > 0 && (
                  <button className="underline" onClick={() => navigate("/models")}>去配置 →</button>
                )}
              </div>
            )}
            <button
              className="flex items-center gap-1.5 rounded-xl bg-accent px-5 py-2 text-sm font-medium text-black disabled:opacity-40"
              disabled={!pack.ready || !story.trim() || busy}
              onClick={start}
            >
              {iconPlay({ width: 14, height: 14 })}
              {busy ? "拆集中…" : "用此风格做成片"}
            </button>
            <p className="text-[11px] text-fg-faint">
              自己做风格：复制 stylePacks/smy-animation，改 pack.json 和 prompts/，点「重新扫描」。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function PackCover(props: { pack: StylePackPublic }) {
  const colors = props.pack.previewColors.length ? props.pack.previewColors : ["#3a332c", "#c4542a", "#2f6f8f"];
  return (
    <div className="flex h-28">
      {colors.map((c) => (
        <div key={c} className="flex-1" style={{ background: c }} />
      ))}
    </div>
  );
}
