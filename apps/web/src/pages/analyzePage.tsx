import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AnalysisReport, Job, RemakeTemplate } from "@vw/core";
import type { Asset } from "@vw/core";
import { api, apiJson } from "../lib/api";
import { useAppStore } from "../lib/store";
import { waitForJob } from "../lib/runGen";
import { iconPlay, iconPlus } from "../lib/icons";
import { AssetPickerModal } from "../components/canvas/assetPickerModal";
import { Modal } from "../components/modal";

export function AnalyzePage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [url, setUrl] = useState(params.get("url") ?? "");
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activeId, setActiveId] = useState<string | null>(params.get("id"));
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [remaking, setRemaking] = useState<AnalysisReport | null>(null);

  const { data: status } = useQuery({
    queryKey: ["analyze-status"],
    queryFn: () => api<{ ytdlp: boolean; hasLlm: boolean; hasVision: boolean }>("/api/analyze/status"),
  });
  const { data: reports } = useQuery({
    queryKey: ["analyze-reports"],
    queryFn: () => api<AnalysisReport[]>("/api/analyze"),
  });
  const { data: report } = useQuery({
    queryKey: ["analyze-report", activeId],
    queryFn: () => api<AnalysisReport>(`/api/analyze/${activeId}`),
    enabled: !!activeId,
  });

  const start = async (input: { url?: string; assetId?: string }) => {
    setError("");
    if (!status?.hasLlm) {
      setError("分析需要文本模型来拆结构和节奏。先到「模型」页加一个。");
      return;
    }
    setBusy(true);
    try {
      const job = await apiJson<Job>("/api/analyze", "post", input);
      const done = await waitForJob(job.id, 10 * 60_000);
      const result = JSON.parse(done.resultJson ?? "{}") as { reportId?: string };
      qc.invalidateQueries({ queryKey: ["analyze-reports"] });
      if (result.reportId) setActiveId(result.reportId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const autoStarted = useRef(false);
  useEffect(() => {
    const preset = params.get("url");
    if (preset && status?.hasLlm && !autoStarted.current) {
      autoStarted.current = true;
      void start({ url: preset });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.hasLlm]);

  return (
    <div className="mx-auto flex h-full max-w-6xl gap-6 p-6">
      <div className="w-[340px] shrink-0">
        <h1 className="text-lg font-semibold">竞品分析</h1>
        <p className="mt-0.5 mb-4 text-xs text-fg-faint">贴一条爆款链接，或从资产库挑视频。拆开结构后，换成你的主题就能开做。</p>

        {!status?.hasLlm && (
          <div className="mb-3 rounded-xl border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
            还没有文本模型。
            <button className="ml-1 underline" onClick={() => navigate("/models")}>去配置 →</button>
          </div>
        )}
        {status?.hasLlm && !status.hasVision && (
          <p className="mb-3 text-[11px] text-fg-faint">当前文本模型不会看图，只能靠转写和抽帧时刻拆结构。到「模型」页勾选「能看图」会更准。</p>
        )}
        {!status?.ytdlp && (
          <p className="mb-3 text-[11px] text-fg-faint">下载器还没打进项目。点分析时会自动补上；也可以先把视频导入资产库。</p>
        )}

        <textarea
          rows={3}
          className="w-full resize-none rounded-xl border border-line bg-panel p-3 text-sm outline-none focus:border-accent-dim"
          placeholder="粘贴抖音 / B站 / YouTube / TikTok 链接…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <div className="mt-2 flex gap-2">
          <button
            className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-black disabled:opacity-40"
            disabled={busy || !url.trim()}
            onClick={() => start({ url: url.trim() })}
          >
            {iconPlay({ width: 12, height: 12 })}
            {busy ? "分析中…" : "开始分析"}
          </button>
          <button className="rounded-lg border border-line px-3 py-2 text-xs text-fg-dim hover:text-fg" onClick={() => setPicking(true)}>
            选资产
          </button>
        </div>
        {error && <div className="mt-2 rounded-lg bg-red-950/30 px-3 py-2 text-xs text-red-300">{error}</div>}

        <label className="mt-3 block cursor-pointer text-[11px] text-fg-faint underline hover:text-fg">
          导入复刻模板 JSON
          <input
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              setError("");
              try {
                const raw = JSON.parse(await f.text()) as unknown;
                await apiJson("/api/remake/templates/import", "post", raw);
                qc.invalidateQueries({ queryKey: ["analyze-reports"] });
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            }}
          />
        </label>

        <h2 className="mt-6 mb-2 text-xs font-medium text-fg-faint">最近报告</h2>
        <p className="mb-2 text-[10px] text-fg-faint">勾两份就能并排对比钩子和节奏。</p>
        <div className="space-y-1.5">
          {reports?.length === 0 && <p className="text-xs text-fg-faint">还没有报告</p>}
          {reports?.map((r) => (
            <div
              key={r.id}
              className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${activeId === r.id ? "border-accent bg-panel-2" : "border-line bg-panel"}`}
            >
              <input
                type="checkbox"
                className="mt-0.5 accent-amber-400"
                checked={compareIds.includes(r.id)}
                onChange={() => {
                  setCompareIds((ids) => {
                    if (ids.includes(r.id)) return ids.filter((x) => x !== r.id);
                    if (ids.length >= 2) return [ids[1]!, r.id];
                    return [...ids, r.id];
                  });
                }}
              />
              <button className="min-w-0 flex-1 text-left hover:text-accent" onClick={() => setActiveId(r.id)}>
                <div className="truncate font-medium">{r.title}</div>
                <div className="text-[10px] text-fg-faint">{r.sourceUrl ? "链接" : "资产"} · {r.report.shots.length} 镜</div>
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto">
        {params.get("from") === "home" && report && compareIds.length !== 2 && !remaking && (
          <div className="mb-4 rounded-xl border border-accent-dim bg-panel p-3 text-xs">
            <div className="mb-1 font-medium text-accent">拆好了，先看一眼</div>
            <p className="text-fg-dim">钩子：{report.report.hook.summary || "—"}</p>
            <p className="mt-1 text-fg-faint">
              {report.report.rhythm.shotCount} 镜 · 结构 {report.report.structure.map((s) => s.name).join(" → ") || "未标"}
            </p>
            <div className="mt-2 flex gap-2">
              <button className="rounded-lg bg-accent px-3 py-1 text-black" onClick={() => setRemaking(report)}>
                换成我的主题
              </button>
              <button className="rounded-lg border border-line px-3 py-1 text-fg-dim" onClick={() => navigate("/analyze")}>
                我先自己看
              </button>
            </div>
          </div>
        )}
        {compareIds.length === 2 ? (
          <CompareView
            left={reports?.find((r) => r.id === compareIds[0]) ?? null}
            right={reports?.find((r) => r.id === compareIds[1]) ?? null}
            onRemake={(r) => setRemaking(r)}
            onClose={() => setCompareIds([])}
          />
        ) : (
          <>
            {!report && <div className="flex h-full items-center justify-center text-sm text-fg-faint">分析完成的报告会出现在这里</div>}
            {report && <ReportView report={report} onRemake={() => setRemaking(report)} />}
          </>
        )}
      </div>

      {picking && (
        <AssetPickerModal
          accept={["video"]}
          onClose={() => setPicking(false)}
          onSelect={(a: Asset) => {
            setPicking(false);
            void start({ assetId: a.id });
          }}
        />
      )}
      {remaking && (
        <RemakeModal
          report={remaking}
          onClose={() => setRemaking(null)}
        />
      )}
    </div>
  );
}

function CompareView(props: {
  left: AnalysisReport | null;
  right: AnalysisReport | null;
  onRemake: (r: AnalysisReport) => void;
  onClose: () => void;
}) {
  return (
    <div className="space-y-3 pb-10">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">对比两份报告</h2>
        <button className="text-xs text-fg-faint underline" onClick={props.onClose}>退出对比</button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {[props.left, props.right].map((r, i) =>
          r ? (
            <div key={r.id} className="rounded-xl border border-line bg-panel p-3">
              <CompareColumn report={r} onRemake={() => props.onRemake(r)} />
            </div>
          ) : (
            <div key={i} className="rounded-xl border border-dashed border-line p-6 text-xs text-fg-faint">还没选这一边</div>
          ),
        )}
      </div>
    </div>
  );
}

function CompareColumn(props: { report: AnalysisReport; onRemake: () => void }) {
  const { report } = props;
  const doc = report.report;
  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold">{report.title}</h3>
        <button className="shrink-0 text-accent underline" onClick={props.onRemake}>复刻</button>
      </div>
      <p><span className="text-fg-faint">钩子 </span>{doc.hook.summary || "—"}</p>
      <p>
        <span className="text-fg-faint">节奏 </span>
        {doc.rhythm.shotCount} 镜 · 均长 {(doc.rhythm.avgShotMs / 1000).toFixed(1)}s
        {doc.rhythm.wordsPerSec !== null ? ` · ${doc.rhythm.wordsPerSec} 字/秒` : ""}
      </p>
      <ul className="space-y-1">
        {doc.structure.map((s, i) => (
          <li key={i}>
            <span className="text-accent">{s.name}</span>
            <span className="text-fg-faint"> {(s.startMs / 1000).toFixed(1)}–{(s.endMs / 1000).toFixed(1)}s </span>
            {s.note}
          </li>
        ))}
      </ul>
      {doc.viralFactors.length > 0 && (
        <p className="text-fg-dim">爆款：{doc.viralFactors.join("、")}</p>
      )}
    </div>
  );
}

function ReportView(props: { report: AnalysisReport; onRemake: () => void }) {
  const { report } = props;
  const doc = report.report;
  return (
    <div className="space-y-5 pb-10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{report.title}</h2>
          {report.sourceUrl && (
            <a className="text-[11px] text-fg-faint underline" href={report.sourceUrl} target="_blank" rel="noreferrer">
              原片链接
            </a>
          )}
          <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-fg-faint">
            {report.usedVision && <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-violet-300">已让模型看画面</span>}
            {(report.words?.length ?? 0) > 0 && <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-sky-300">词级转写 {report.words.length} 词</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            className="rounded-lg border border-line px-3 py-2 text-xs text-fg-dim hover:text-fg"
            onClick={async () => {
              const tpl = await apiJson<RemakeTemplate>("/api/remake/from-report", "post", { reportId: report.id });
              const data = await api<unknown>(`/api/remake/templates/${tpl.id}/export`);
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `${tpl.name || "复刻模板"}.json`;
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            导出模板
          </button>
          <button className="rounded-lg bg-accent px-4 py-2 text-xs font-medium text-black hover:brightness-110" onClick={props.onRemake}>
            换成我的主题做成片
          </button>
        </div>
      </div>

      {report.frames.length > 0 && (
        <div className="flex gap-2 overflow-x-auto">
          {report.frames.map((f) => (
            <div key={f.file} className="shrink-0">
              <img
                src={`/api/analyze/${report.id}/frames/${f.file}`}
                className="h-20 w-28 rounded-lg object-cover"
                alt=""
              />
              <div className="mt-0.5 text-center text-[10px] text-fg-faint">{(f.tMs / 1000).toFixed(1)}s</div>
            </div>
          ))}
        </div>
      )}

      <section className="rounded-xl border border-line bg-panel p-4">
        <h3 className="mb-1 text-xs font-medium text-fg-faint">钩子（前 3 秒）</h3>
        <p className="text-sm">{doc.hook.summary || "—"}</p>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-medium text-fg-faint">结构</h3>
        <div className="grid gap-2 md:grid-cols-2">
          {doc.structure.map((s, i) => (
            <div key={i} className="rounded-xl border border-line bg-panel p-3">
              <div className="text-xs text-accent">{s.name}</div>
              <div className="text-[10px] text-fg-faint">{(s.startMs / 1000).toFixed(1)}s – {(s.endMs / 1000).toFixed(1)}s</div>
              <p className="mt-1 text-xs text-fg-dim">{s.note}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-medium text-fg-faint">逐镜</h3>
        <div className="space-y-2">
          {doc.shots.map((s, i) => (
            <div key={i} className="rounded-xl border border-line bg-panel px-3 py-2">
              <div className="text-[10px] text-fg-faint">
                #{i + 1} · {(s.startMs / 1000).toFixed(1)}s–{(s.endMs / 1000).toFixed(1)}s
              </div>
              <div className="text-sm">{s.visual}</div>
              {s.line && <div className="text-xs text-fg-dim">台词：{s.line}</div>}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-line bg-panel p-4">
        <h3 className="mb-1 text-xs font-medium text-fg-faint">节奏</h3>
        <p className="text-xs text-fg-dim">
          {doc.rhythm.shotCount} 镜 · 均长 {(doc.rhythm.avgShotMs / 1000).toFixed(1)}s
          {doc.rhythm.wordsPerSec !== null ? ` · 约 ${doc.rhythm.wordsPerSec} 字/秒` : ""}
        </p>
        {doc.rhythm.note && <p className="mt-1 text-xs text-fg-faint">{doc.rhythm.note}</p>}
      </section>

      {doc.viralFactors.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-medium text-fg-faint">爆款因子</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-fg-dim">
            {doc.viralFactors.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function RemakeModal(props: { report: AnalysisReport; onClose: () => void }) {
  const navigate = useNavigate();
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);
  const setPendingAutoRun = useAppStore((s) => s.setPendingAutoRun);
  const vars = props.report.report.template.variables;
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(vars.map((v) => [v, ""])));
  const [variantCount, setVariantCount] = useState(1);
  const [step, setStep] = useState<"fill" | "confirm">("fill");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setError("");
    setBusy(true);
    try {
      const tpl = await apiJson<RemakeTemplate>("/api/remake/from-report", "post", { reportId: props.report.id });
      const job = await apiJson<Job>("/api/remake/run", "post", {
        templateId: tpl.id,
        reportId: props.report.id,
        variables: values,
        variantCount,
      });
      const done = await waitForJob(job.id, 5 * 60_000);
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
    <Modal title="换成我的主题" onClose={props.onClose} width="w-[440px]">
      {step === "fill" ? (
        <>
          <p className="mb-3 text-xs text-fg-faint">骨架沿用「{props.report.report.template.name}」，只换你的内容。可一次开多个变体，各自一套画布和时间线。</p>
          <div className="space-y-2">
            {vars.map((v) => (
              <input
                key={v}
                className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent-dim"
                placeholder={v}
                value={values[v] ?? ""}
                onChange={(e) => setValues((m) => ({ ...m, [v]: e.target.value }))}
              />
            ))}
          </div>
          <label className="mt-3 flex items-center justify-between text-xs text-fg-dim">
            变体数量
            <select
              className="rounded-lg border border-line bg-panel-2 px-2 py-1"
              value={variantCount}
              onChange={(e) => setVariantCount(Number(e.target.value))}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>{n} 个</option>
              ))}
            </select>
          </label>
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button className="rounded-lg border border-line px-3 py-1.5 text-sm text-fg-dim" onClick={props.onClose}>取消</button>
            <button
              className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-black"
              onClick={() => setStep("confirm")}
            >
              下一步，确认槽位
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mb-3 text-xs text-fg-faint">按这个做成 {variantCount} 个变体。槽位数量和时长不改，只换你填的内容。</p>
          <p className="mb-2 text-sm font-medium">{props.report.report.template.name}</p>
          <ul className="mb-3 space-y-1.5 text-xs">
            {props.report.report.template.slots.map((slot) => (
              <li key={slot.id} className="rounded-lg border border-line bg-panel-2 px-2 py-1.5">
                <span className="text-accent">{slot.id}</span>
                <span className="text-fg-faint"> · {slot.maxSec}s · </span>
                {slot.shotDesc}
                {slot.lineSlot && <div className="text-fg-dim">台词槽：{slot.lineSlot}</div>}
              </li>
            ))}
          </ul>
          <ul className="mb-3 space-y-0.5 text-xs text-fg-dim">
            {vars.map((v) => (
              <li key={v}>{v}：{values[v]?.trim() || "（空着，模型自己补）"}</li>
            ))}
          </ul>
          {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <button className="rounded-lg border border-line px-3 py-1.5 text-sm text-fg-dim" onClick={() => setStep("fill")}>
              返回改
            </button>
            <button
              className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-black disabled:opacity-40"
              disabled={busy}
              onClick={run}
            >
              {iconPlus({ width: 12, height: 12 })}
              {busy ? "改写中…" : "确认，做成片"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
