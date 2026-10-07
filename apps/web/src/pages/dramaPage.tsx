import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CharacterDossier, DramaBible, Job, PipelineRun, Series, StoryEvent } from "@vw/core";
import { api, apiJson } from "../lib/api";
import { usePrefs } from "../lib/prefs";
import { useAppStore } from "../lib/store";
import { waitForJob } from "../lib/runGen";
import { iconPlay, iconUpload } from "../lib/icons";
import { Modal } from "../components/modal";

type Source = "file" | "url" | "paste";
type SeriesMode = "new" | "continue";

export function DramaPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);
  const setPendingAutoRun = useAppStore((s) => s.setPendingAutoRun);
  const autoSubtitles = usePrefs((s) => s.autoSubtitles);

  const { data: seriesList } = useQuery({
    queryKey: ["series"],
    queryFn: () => api<Series[]>("/api/series"),
  });
  const { data: llmReady } = useQuery({
    queryKey: ["analyze-status"],
    queryFn: () => api<{ hasLlm: boolean }>("/api/analyze/status"),
  });

  const pipelineId = params.get("pipeline");
  const { data: pipe } = useQuery({
    queryKey: ["pipeline", pipelineId],
    queryFn: () => api<PipelineRun>(`/api/pipelines/${pipelineId}`),
    enabled: !!pipelineId,
  });

  useEffect(() => {
    const sid = params.get("series");
    if (!sid) return;
    const s = seriesList?.find((x) => x.id === sid);
    if (!s) return;
    setSeriesMode("continue");
    setSeriesId(s.id);
  }, [params, seriesList]);

  const [source, setSource] = useState<Source>("file");
  const [fileLabel, setFileLabel] = useState("");
  const [url, setUrl] = useState("");
  const [story, setStory] = useState("");
  const [clipped, setClipped] = useState(false);
  const [seriesMode, setSeriesMode] = useState<SeriesMode>(params.get("series") ? "continue" : "new");
  const [seriesName, setSeriesName] = useState("");
  const [seriesId, setSeriesId] = useState(params.get("series") ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<{ kind: "character" | "event"; id: string } | null>(null);

  const dramaSeries = (seriesList ?? []).filter((s) => s.kind === "drama" || s.kind === "free");
  const bible = pipe?.bible ?? null;
  const reviewing = pipe?.status === "waiting" && (pipe.currentStep === "cast" || !bible?.episodes.length);

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    setFileLabel(file.name);
    const text = await file.text();
    if (text.trim().length < 20) {
      setError("这个文件几乎是空的。请上传小说正文 txt / md。");
      return;
    }
    const clip = await apiJson<{ text: string; clipped: boolean }>("/api/series/clip", "post", { text });
    setStory(clip.text);
    setClipped(clip.clipped);
    setError("");
    if (!seriesName) setSeriesName(file.name.replace(/\.[^.]+$/, "").slice(0, 24));
  };

  const loadUrl = async () => {
    if (!url.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const doc = await apiJson<{ title: string; text: string; clipped: boolean }>("/api/series/fetch", "post", { url: url.trim() });
      setStory(doc.text);
      setClipped(doc.clipped);
      if (!seriesName) setSeriesName(doc.title.slice(0, 24));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (!story.trim() || busy) return;
    if (seriesMode === "continue" && !seriesId) {
      setError("先选一部要接的连载。");
      return;
    }
    if (!llmReady?.hasLlm) {
      setError("通读全文认人物需要文本模型。先到「模型」页加一个。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const job = await apiJson<Job>("/api/pipelines/run", "post", {
        story: story.trim(),
        seriesId: seriesMode === "continue" ? seriesId : undefined,
        seriesName: seriesMode === "new" ? seriesName.trim() || "短剧连载" : undefined,
        kind: "drama",
      });
      const done = await waitForJob(job.id, 8 * 60_000);
      const result = JSON.parse(done.resultJson ?? "{}") as { projectId?: string; pipelineId?: string; waiting?: boolean };
      if (!result.pipelineId && !result.projectId) throw new Error("没有列出人物");
      if (result.projectId) setCurrentProject(result.projectId);
      if (result.pipelineId) {
        setParams({ pipeline: result.pipelineId });
        qc.invalidateQueries({ queryKey: ["pipeline", result.pipelineId] });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const goOn = async () => {
    if (!pipe || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await apiJson<{ projectId: string }>("/api/pipelines/" + pipe.id + "/advance", "post");
      setCurrentProject(r.projectId);
      setPendingAutoRun(false);
      navigate("/canvas");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto h-full max-w-3xl overflow-y-auto p-6">
      <h1 className="text-lg font-semibold">小说转短剧</h1>
      <p className="mt-1 mb-5 text-xs text-fg-faint">
        上传小说或贴能打开的链接。列出人物和事件后，下面有对话框能整份改，比如「全部改成中文」。单条仍可点开改。
      </p>

      {!reviewing && (
        <>
          <div className="mb-3 flex gap-1 rounded-lg border border-line bg-panel-2 p-1">
            {(
              [
                ["file", "上传文本"],
                ["url", "小说链接"],
                ["paste", "粘贴正文"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                className={`flex-1 rounded-md px-2 py-1.5 text-xs ${source === k ? "bg-accent text-black" : "text-fg-dim"}`}
                onClick={() => setSource(k)}
              >
                {label}
              </button>
            ))}
          </div>

          {source === "file" && (
            <label className="mb-3 block cursor-pointer rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-fg-dim hover:border-accent-dim">
              <input type="file" accept=".txt,.md,.text" className="hidden" onChange={(e) => void loadFile(e.target.files?.[0])} />
              {iconUpload({ width: 18, height: 18 })}
              <div className="mt-2">{fileLabel || "上传 .txt / .md"}</div>
            </label>
          )}
          {source === "url" && (
            <div className="mb-3 flex gap-2">
              <input
                className="flex-1 rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent-dim"
                placeholder="能直接打开的章节链接，不要登录墙"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <button className="rounded-lg border border-line px-3 py-2 text-xs text-fg-dim" disabled={busy} onClick={loadUrl}>
                {busy ? "打开中…" : "拉取"}
              </button>
            </div>
          )}
          {source === "paste" && (
            <textarea
              rows={8}
              className="mb-3 w-full resize-y rounded-xl border border-line bg-panel p-3 text-sm outline-none focus:border-accent-dim"
              placeholder="把小说正文贴进来"
              value={story}
              onChange={(e) => setStory(e.target.value)}
            />
          )}

          {story && source !== "paste" && (
            <div className="mb-3 rounded-xl border border-line bg-panel p-3 text-xs text-fg-dim">
              已读入 {story.length} 字。{clipped && "正文太长，先用前 2 万字做这一季，下一章再接到同一连载。"}
              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-[11px] text-fg-faint">
                {story.slice(0, 400)}
                {story.length > 400 ? "…" : ""}
              </pre>
            </div>
          )}

          {story.trim() && (
            <DramaChatBox
              placeholder="比如：翻成中文，人名也译过来"
              button="按这句话改正文"
              busy={busy}
              onSubmit={async (instruction) => {
                setBusy(true);
                setError("");
                try {
                  const next = await apiJson<{ text: string; clipped: boolean }>("/api/series/rewrite", "post", {
                    text: story,
                    instruction,
                  });
                  setStory(next.text);
                  setClipped(next.clipped);
                  setSource("paste");
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
            />
          )}

          <section className="mb-4">
            <h2 className="mb-2 text-xs text-fg-faint">连载</h2>
            <div className="mb-2 flex gap-2">
              <button
                className={`rounded-lg px-3 py-1.5 text-xs ${seriesMode === "new" ? "bg-accent text-black" : "border border-line text-fg-dim"}`}
                onClick={() => setSeriesMode("new")}
              >
                新开一部
              </button>
              <button
                className={`rounded-lg px-3 py-1.5 text-xs ${seriesMode === "continue" ? "bg-accent text-black" : "border border-line text-fg-dim"}`}
                onClick={() => setSeriesMode("continue")}
              >
                接到已有连载
              </button>
            </div>
            {seriesMode === "new" && (
              <input
                className="w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none"
                placeholder="连载名字，例如：武松打虎"
                value={seriesName}
                onChange={(e) => setSeriesName(e.target.value)}
              />
            )}
            {seriesMode === "continue" && (
              <div className="flex flex-wrap gap-1.5">
                {dramaSeries.length === 0 && <p className="text-xs text-fg-faint">还没有连载。先新开一部。</p>}
                {dramaSeries.map((s) => (
                  <button
                    key={s.id}
                    className={`rounded-full px-3 py-1 text-xs ${seriesId === s.id ? "bg-accent text-black" : "border border-line text-fg-dim"}`}
                    onClick={() => setSeriesId(s.id)}
                  >
                    {s.name} · 已 {s.episodeCount} 集
                  </button>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {reviewing && bible && pipe && (
        <>
          <CastReview
            bible={bible}
            locked={seriesMode === "continue"}
            onEdit={(kind, id) => setEditing({ kind, id })}
          />
          <DramaChatBox
            placeholder="比如：全部改成中文 / 事件压成 8 条 / 人物用本名"
            button="按这句话改整份"
            busy={busy}
            onSubmit={async (instruction) => {
              setBusy(true);
              setError("");
              try {
                const next = await apiJson<DramaBible>(`/api/pipelines/${pipe.id}/revise`, "post", {
                  target: "all",
                  instruction,
                });
                qc.setQueryData(["pipeline", pipe.id], (old: PipelineRun | undefined) =>
                  old ? { ...old, bible: next } : old,
                );
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          />
        </>
      )}

      {error && <p className="mb-3 text-xs text-amber-300">{error}</p>}

      {!reviewing ? (
        <button
          className="flex items-center gap-1.5 rounded-xl bg-accent px-5 py-2 text-sm font-medium text-black disabled:opacity-40"
          disabled={!story.trim() || busy}
          onClick={start}
        >
          {iconPlay({ width: 14, height: 14 })}
          {busy ? "正在通读全文…" : seriesMode === "continue" ? "接到这部，抽下一章事件" : "做成短剧连载"}
        </button>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-xl bg-accent px-5 py-2 text-sm font-medium text-black disabled:opacity-40"
            disabled={busy}
            onClick={goOn}
          >
            {busy ? "按档案拆集…" : "满意，往下走"}
          </button>
          {pipe?.projectId && (bible?.episodes?.length ?? 0) > 0 ? (
            <button
              className="rounded-xl border border-line px-4 py-2 text-sm text-fg-dim disabled:opacity-40"
              disabled={busy}
              onClick={async () => {
                if (!pipe.projectId) return;
                setBusy(true);
                setError("");
                try {
                  const job = await apiJson<Job>("/api/pipelines/render-episode", "post", {
                    projectId: pipe.projectId,
                    withSubtitles: autoSubtitles,
                  });
                  await waitForJob(job.id, 20 * 60_000);
                  setCurrentProject(pipe.projectId);
                  navigate("/timeline");
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "正在出集…" : "出这一集"}
            </button>
          ) : null}
          <button
            className="rounded-xl border border-line px-4 py-2 text-sm text-fg-dim"
            disabled={busy || !pipe}
            onClick={async () => {
              if (!pipe) return;
              setBusy(true);
              setError("");
              try {
                const job = await apiJson<Job>(`/api/pipelines/${pipe.id}/retry-step`, "post");
                const done = await waitForJob(job.id, 8 * 60_000);
                const result = JSON.parse(done.resultJson ?? "{}") as { pipelineId?: string };
                if (result.pipelineId) {
                  setParams({ pipeline: result.pipelineId });
                  qc.invalidateQueries({ queryKey: ["pipeline", result.pipelineId] });
                } else {
                  qc.invalidateQueries({ queryKey: ["pipeline", pipe.id] });
                }
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            整份重列
          </button>
        </div>
      )}

      {editing && bible && pipe && (
        <ReviseDialog
          kind={editing.kind}
          bible={bible}
          targetId={editing.id}
          pipelineId={pipe.id}
          onClose={() => setEditing(null)}
          onSaved={(next) => {
            qc.setQueryData(["pipeline", pipe.id], (old: PipelineRun | undefined) =>
              old ? { ...old, bible: next } : old,
            );
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function CastReview(props: {
  bible: DramaBible;
  locked: boolean;
  onEdit: (kind: "character" | "event", id: string) => void;
}) {
  const cast = props.bible.cast ?? [];
  const events = props.bible.events ?? [];
  const chapters = [...new Set(events.map((e) => e.chapter || "未分章"))];
  return (
    <div className="mb-5 space-y-5">
      <div>
        <h2 className="text-base font-medium">{props.bible.title}</h2>
        <p className="text-[11px] text-fg-faint">下面对话框能整份改。点卡片只改这一条。</p>
      </div>
      <section>
        <h3 className="mb-2 text-xs text-fg-faint">出场人物{props.locked ? "（沿用上集，仍可点开微调）" : ""}</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {cast.map((c) => (
            <button
              key={c.id}
              className="rounded-xl border border-line bg-panel p-3 text-left hover:border-accent-dim"
              onClick={() => props.onEdit("character", c.id)}
            >
              <div className="flex gap-3">
                {c.imageAssetId || c.views?.[0]?.assetId ? (
                  <div className="flex shrink-0 gap-0.5">
                    {(c.views?.length ? c.views : [{ kind: "front" as const, assetId: c.imageAssetId! }]).map((v) => (
                      <img
                        key={v.kind}
                        src={`/api/assets/${v.assetId}/file?variant=thumb`}
                        alt=""
                        className="h-16 w-10 rounded-lg object-cover"
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex h-16 w-12 shrink-0 items-center justify-center rounded-lg bg-panel-2 text-[10px] text-fg-faint">点开改</div>
                )}
                <div className="min-w-0">
                  <div className="text-sm font-medium">{c.name}</div>
                  <div className="text-[11px] text-accent">{c.identity || "身份待补"}</div>
                  <p className="mt-1 line-clamp-3 text-[11px] text-fg-dim">
                    {[c.appearance, c.outfit, c.personality].filter(Boolean).join(" · ") || c.prompt}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>
      {(props.bible.assets ?? []).some((a) => a.kind !== "character") ? (
        <section>
          <h3 className="mb-2 text-xs text-fg-faint">场景和道具（跨集沿用）</h3>
          <div className="flex flex-wrap gap-2">
            {(props.bible.assets ?? [])
              .filter((a) => a.kind !== "character")
              .map((a) => (
                <div key={a.id} className="flex items-center gap-2 rounded-xl border border-line bg-panel px-2 py-1.5">
                  {a.imageAssetId ? (
                    <img src={`/api/assets/${a.imageAssetId}/file?variant=thumb`} alt="" className="h-10 w-10 rounded object-cover" />
                  ) : null}
                  <div>
                    <div className="text-xs">{a.name}</div>
                    <div className="text-[10px] text-fg-faint">{a.kind === "prop" ? "道具" : "场景"}</div>
                  </div>
                </div>
              ))}
          </div>
        </section>
      ) : null}
      <section>
        <h3 className="mb-2 text-xs text-fg-faint">事件清单</h3>
        <div className="space-y-3">
          {chapters.map((ch) => (
            <div key={ch}>
              <div className="mb-1 text-[11px] text-fg-faint">{ch}</div>
              <div className="space-y-1.5">
                {events
                  .filter((e) => (e.chapter || "未分章") === ch)
                  .map((e) => (
                    <button
                      key={e.id}
                      className="w-full rounded-xl border border-line bg-panel px-3 py-2 text-left hover:border-accent-dim"
                      onClick={() => props.onEdit("event", e.id)}
                    >
                      <div className="text-sm">{e.title || "未命名事件"}</div>
                      <p className="text-[11px] text-fg-dim">{e.summary}</p>
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ReviseDialog(props: {
  kind: "character" | "event";
  bible: DramaBible;
  targetId: string;
  pipelineId: string;
  onClose: () => void;
  onSaved: (bible: DramaBible) => void;
}) {
  const character = props.bible.cast?.find((c) => c.id === props.targetId) ?? null;
  const event = props.bible.events?.find((e) => e.id === props.targetId) ?? null;
  const title = props.kind === "character" ? `改角色 · ${character?.name ?? ""}` : `改事件 · ${event?.title ?? ""}`;
  const [instruction, setInstruction] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pickImage = (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    const reader = new FileReader();
    reader.onload = () => setPreview(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(f);
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      let images: Array<{ mime: string; dataBase64: string }> | undefined;
      if (file && preview) {
        images = [{ mime: file.type || "image/jpeg", dataBase64: preview }];
      }
      const next = await apiJson<DramaBible>(`/api/pipelines/${props.pipelineId}/revise`, "post", {
        target: props.kind,
        targetId: props.targetId,
        instruction,
        images,
      });
      props.onSaved(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Modal title={title} onClose={props.onClose} width="w-[480px]">
      {props.kind === "character" && character && <DossierPreview c={character} />}
      {props.kind === "event" && event && <EventPreview e={event} />}
      <textarea
        autoFocus
        rows={4}
        className="mt-3 w-full resize-none rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent-dim"
        placeholder={props.kind === "character" ? "比如：再年轻一点，穿深蓝长袍，眼神冷" : "比如：把冲突写到酒后上山这一拍"}
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
      />
      {props.kind === "character" && (
        <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-fg-dim">
          <input type="file" accept="image/*" className="hidden" onChange={(e) => pickImage(e.target.files?.[0])} />
          {preview ? <img src={preview} alt="" className="h-12 w-12 rounded-lg object-cover" /> : null}
          {preview ? "换一张参考图" : "也可以丢一张参考图"}
        </label>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button className="rounded-lg border border-line px-3 py-1.5 text-sm text-fg-dim" onClick={props.onClose}>
          取消
        </button>
        <button
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-black disabled:opacity-40"
          disabled={busy || (!instruction.trim() && !file)}
          onClick={save}
        >
          {busy ? "重写中…" : "按这句话重生成"}
        </button>
      </div>
    </Modal>
  );
}

function DramaChatBox(props: {
  placeholder: string;
  button: string;
  busy: boolean;
  onSubmit: (instruction: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const send = async () => {
    const instruction = text.trim();
    if (!instruction || props.busy) return;
    await props.onSubmit(instruction);
    setText("");
  };
  return (
    <div className="mb-4 rounded-xl border border-line bg-panel p-3">
      <textarea
        rows={3}
        className="w-full resize-y rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent-dim"
        placeholder={props.placeholder}
        value={text}
        disabled={props.busy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void send();
          }
        }}
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[10px] text-fg-faint">⌘ / Ctrl + Enter</span>
        <button
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-black disabled:opacity-40"
          disabled={props.busy || !text.trim()}
          onClick={() => void send()}
        >
          {props.busy ? "在改…" : props.button}
        </button>
      </div>
    </div>
  );
}

function DossierPreview(props: { c: CharacterDossier }) {
  const { c } = props;
  return (
    <dl className="grid grid-cols-[4rem_1fr] gap-x-2 gap-y-1 text-xs">
      <dt className="text-fg-faint">身份</dt>
      <dd>{c.identity || "—"}</dd>
      <dt className="text-fg-faint">外貌</dt>
      <dd>{c.appearance || "—"}</dd>
      <dt className="text-fg-faint">穿搭</dt>
      <dd>{c.outfit || "—"}</dd>
      <dt className="text-fg-faint">性格</dt>
      <dd>{c.personality || "—"}</dd>
    </dl>
  );
}

function EventPreview(props: { e: StoryEvent }) {
  return <p className="text-xs text-fg-dim">{props.e.summary || props.e.title}</p>;
}
