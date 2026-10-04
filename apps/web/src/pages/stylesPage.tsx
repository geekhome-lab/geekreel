import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Job, StylePackPublic } from "@vw/core";
import type { Capability, ModelEndpoint } from "@vw/models";
import { api, apiJson } from "../lib/api";
import { useAppStore } from "../lib/store";
import { waitForJob } from "../lib/runGen";
import { iconPlay, iconPlus, iconTrash } from "../lib/icons";
import { Modal } from "../components/modal";

export function StylesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
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
  const [adding, setAdding] = useState(false);

  const chosenSub = substyle || pack?.defaultSubstyle || "";

  const missing = useMemo(() => {
    if (!pack) return [] as string[];
    const have = new Set((endpoints ?? []).filter((e) => e.enabled).map((e) => e.capability as Capability));
    return pack.requiredCapabilities.filter((c) => !have.has(c));
  }, [pack, endpoints]);

  const start = async () => {
    if (!pack || busy) return;
    if (pack.id !== "whiteboard") {
      navigate("/drama");
      return;
    }
    if (!story.trim()) return;
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
      if (pack.id === "whiteboard") {
        navigate("/timeline");
      } else {
        setPendingAutoRun(true);
        navigate("/canvas");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!pack?.editable) return;
    if (!confirm(`删除「${pack.name}」？只删风格包，已做的项目还在。`)) return;
    try {
      await apiJson(`/api/styles/${pack.id}`, "delete");
      qc.invalidateQueries({ queryKey: ["styles"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="mx-auto flex h-full max-w-6xl gap-6 p-6">
      <div className="w-[300px] shrink-0">
        <h1 className="text-lg font-semibold">风格中心</h1>
        <p className="mt-0.5 mb-3 text-xs text-fg-faint">
          内置两套。第三套自己加：贴 GitHub 技能链接、自定义风格，或上传 SKILL.md。
        </p>
        <div className="mb-3 flex gap-2">
          <button
            className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-black"
            onClick={() => setAdding(true)}
          >
            {iconPlus({ width: 12, height: 12 })}
            添加风格
          </button>
          <button className="rounded-lg border border-line px-3 py-2 text-[11px] text-fg-faint hover:text-fg" onClick={() => refetch()}>
            扫描
          </button>
        </div>
        <div className="space-y-2">
          {packs?.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setActiveId(p.id);
                setSubstyle(p.defaultSubstyle ?? "");
                setError("");
              }}
              className={`w-full overflow-hidden rounded-xl border text-left ${
                pack?.id === p.id ? "border-accent bg-panel-2" : "border-line bg-panel hover:border-accent-dim"
              }`}
            >
              <PackCover pack={p} />
              <div className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{p.name}</span>
                  {p.source === "user" && <span className="text-[10px] text-accent">自建</span>}
                  {!p.ready && <span className="text-[10px] text-fg-faint">未开放</span>}
                </div>
                <p className="mt-0.5 line-clamp-2 text-[11px] text-fg-faint">{p.summary}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto">
        {!pack && <p className="text-sm text-fg-faint">还没有风格。点左上角「添加风格」。</p>}
        {pack && (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{pack.name}</h2>
                <p className="mt-1 text-sm text-fg-dim">{pack.summary}</p>
                <p className="mt-2 text-[11px] text-fg-faint">
                  需要：{pack.requiredCapabilities.length ? pack.requiredCapabilities.join("、") : "不用配模型"}
                  {" · "}
                  {pack.source === "user" ? "自建" : "内置"}
                  {pack.originUrl ? " · 来自链接" : ""}
                </p>
              </div>
              {pack.editable && (
                <button className="rounded-lg border border-line p-2 text-fg-faint hover:text-red-300" onClick={remove} title="删除这套自建风格">
                  {iconTrash({})}
                </button>
              )}
            </div>

            {!pack.ready && (
              <div className="rounded-xl border border-amber-900/50 bg-amber-950/30 px-4 py-3 text-xs text-amber-200">
                {pack.unavailableReason}
              </div>
            )}

            {pack.id === "whiteboard" && pack.substyles.length > 0 && (
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

            {pack.id === "whiteboard" && (
              <p className="text-xs text-fg-dim">
                贴字幕就能出纸底片子。配了图片模型以后，还可以到画布里换成手绘线稿。
              </p>
            )}
            {pack.id !== "whiteboard" && (
              <p className="text-xs text-fg-dim">
                小说转短剧请到单独一页：上传文本或贴链接，并选连载。子风格在那边选。
              </p>
            )}

            {pack.id === "whiteboard" && (
            <textarea
              rows={5}
              className="w-full resize-none rounded-xl border border-line bg-panel p-3 text-sm outline-none focus:border-accent-dim"
              placeholder="贴一段 SRT，或按行写口播。例如：先把问题说清楚"
              value={story}
              onChange={(e) => setStory(e.target.value)}
            />
            )}
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
              disabled={!pack.ready || busy || (pack.id === "whiteboard" && !story.trim())}
              onClick={start}
            >
              {iconPlay({ width: 14, height: 14 })}
              {busy
                ? "做片子…"
                : pack.id === "whiteboard"
                  ? "做成白板片子"
                  : "去小说转短剧"}
            </button>
          </div>
        )}
      </div>

      {adding && (
        <AddStyleModal
          onClose={() => setAdding(false)}
          onAdded={(id) => {
            setAdding(false);
            setActiveId(id);
            qc.invalidateQueries({ queryKey: ["styles"] });
          }}
        />
      )}
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

type AddMode = "url" | "write" | "upload";

function AddStyleModal(props: { onClose: () => void; onAdded: (id: string) => void }) {
  const [mode, setMode] = useState<AddMode>("url");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [brief, setBrief] = useState("");
  const [fileLabel, setFileLabel] = useState("");
  const [fileText, setFileText] = useState("");
  const [filename, setFilename] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setFileLabel(file.name);
    setFilename(file.name);
    if (file.name.toLowerCase().endsWith(".zip")) {
      const buf = new Uint8Array(await file.arrayBuffer());
      let bin = "";
      buf.forEach((b) => {
        bin += String.fromCharCode(b);
      });
      setFileText(btoa(bin));
    } else {
      setFileText(await file.text());
    }
  };

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const job = await apiJson<Job>("/api/styles/import", "post", {
        mode,
        name: name.trim(),
        url: url.trim() || undefined,
        brief: brief.trim() || undefined,
        text: mode === "upload" ? fileText : brief.trim() || undefined,
        filename: mode === "upload" ? filename : undefined,
      });
      const done = await waitForJob(job.id, 3 * 60_000);
      const result = JSON.parse(done.resultJson ?? "{}") as { packId?: string };
      if (!result.packId) throw new Error("没有写成风格包");
      props.onAdded(result.packId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Modal title="添加风格" onClose={props.onClose} width="w-[520px]">
      <p className="mb-3 text-xs text-fg-faint">
        给新风格起个名字，再选一种来源。写成之后和上美影一样能直接做短剧。
      </p>
      <div className="mb-3 flex gap-1 rounded-lg border border-line bg-panel-2 p-1">
        {(
          [
            ["url", "贴技能链接"],
            ["write", "自定义风格"],
            ["upload", "上传文件"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            className={`flex-1 rounded-md px-2 py-1.5 text-xs ${mode === k ? "bg-accent text-black" : "text-fg-dim"}`}
            onClick={() => setMode(k)}
          >
            {label}
          </button>
        ))}
      </div>
      <input
        className="mb-2 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent-dim"
        placeholder="风格名字，例如：电商带货"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      {mode === "url" && (
        <>
          <input
            className="mb-2 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent-dim"
            placeholder="GitHub 仓库 / 技能目录 / SKILL.md 链接"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <textarea
            rows={2}
            className="w-full resize-none rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent-dim"
            placeholder="可选：转成什么样，比如「只要出图提示词，做成竖屏带货风」"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
          />
        </>
      )}
      {mode === "write" && (
        <textarea
          rows={5}
          className="w-full resize-none rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent-dim"
          placeholder="描述这套风格。例如：短视频带货，商品大特写，红金主色，口播字幕靠下。"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
        />
      )}
      {mode === "upload" && (
        <label className="block cursor-pointer rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-fg-dim hover:border-accent-dim">
          <input
            type="file"
            accept=".md,.json,.txt,.zip"
            className="hidden"
            onChange={(e) => void pickFile(e.target.files?.[0])}
          />
          {fileLabel || "上传 SKILL.md / pack.json / zip"}
        </label>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button className="rounded-lg border border-line px-3 py-1.5 text-sm text-fg-dim" onClick={props.onClose}>
          取消
        </button>
        <button
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-black disabled:opacity-40"
          disabled={!name.trim() || busy}
          onClick={submit}
        >
          {busy ? "转换中…" : "转成这个风格"}
        </button>
      </div>
    </Modal>
  );
}
