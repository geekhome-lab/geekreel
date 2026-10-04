import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  intervalPresets,
  pushChannelLabels,
  type Job,
  type PushChannel,
  type PushChannelType,
  type PushLog,
  type RadarItem,
  type RadarSettings,
  type RadarSource,
  type RadarSub,
} from "@vw/core";
import { api, apiJson } from "../lib/api";
import { useAppStore } from "../lib/store";
import { waitForJob } from "../lib/runGen";
import { iconPlus, iconRefresh, iconTrash } from "../lib/icons";
import { Modal } from "../components/modal";

type Tab = "board" | "watch" | "push";

export function RadarPage() {
  const [tab, setTab] = useState<Tab>("board");
  const navigate = useNavigate();
  const { data: status } = useQuery({
    queryKey: ["radar-status"],
    queryFn: () => api<{ hasWebSearchLlm: boolean }>("/api/radar/status"),
  });

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-5">
        <h1 className="text-lg font-semibold">热点雷达</h1>
        <p className="mt-0.5 text-xs text-fg-faint">
          用你配置的联网文本模型去查各平台在聊什么。热度是 AI 估计，不是官方榜。
        </p>
      </div>

      {status && !status.hasWebSearchLlm && (
        <div className="mb-4 rounded-xl border border-amber-900/50 bg-amber-950/30 px-4 py-3 text-xs text-amber-200">
          还没有会联网的文本模型，雷达查不到真热点。
          <button className="ml-2 underline hover:text-amber-100" onClick={() => navigate("/models")}>
            去模型页添加，并勾选「支持联网搜索」→
          </button>
        </div>
      )}

      <div className="mb-4 flex gap-1 rounded-lg border border-line bg-panel p-1">
        {(
          [
            ["board", "今日热榜"],
            ["watch", "我的关注"],
            ["push", "推送到哪"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs ${tab === k ? "bg-panel-2 text-accent" : "text-fg-dim hover:text-fg"}`}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "board" && <BoardPane canFetch={!!status?.hasWebSearchLlm} />}
      {tab === "watch" && <WatchPane />}
      {tab === "push" && <PushPane />}
    </div>
  );
}

function BoardPane(props: { canFetch: boolean }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);
  const setPendingAutoRun = useAppStore((s) => s.setPendingAutoRun);
  const [searchParams] = useSearchParams();
  const highlight = searchParams.get("item");
  const [platform, setPlatform] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const { data: items } = useQuery({
    queryKey: ["radar-board", platform],
    queryFn: () => api<RadarItem[]>(`/api/radar/board${platform ? `?platform=${encodeURIComponent(platform)}` : ""}`),
  });
  const { data: sources } = useQuery({
    queryKey: ["radar-sources"],
    queryFn: () => api<RadarSource[]>("/api/radar/sources"),
  });

  const platforms = useMemo(() => {
    const set = new Set((sources ?? []).map((s) => s.platform));
    return [...set];
  }, [sources]);

  const refresh = async () => {
    setError("");
    setBusy(true);
    try {
      const r = await apiJson<{ jobs: Job[] }>("/api/radar/run-all", "post");
      const settled = await Promise.allSettled(r.jobs.map((j) => waitForJob(j.id, 3 * 60_000)));
      const fail = settled.find((x): x is PromiseRejectedResult => x.status === "rejected");
      if (fail) setError(fail.reason instanceof Error ? fail.reason.message : String(fail.reason));
      qc.invalidateQueries({ queryKey: ["radar-board"] });
      qc.invalidateQueries({ queryKey: ["radar-sources"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const makeVideo = async (item: RadarItem) => {
    setError("");
    try {
      const r = await apiJson<{ projectId: string }>("/api/radar/to-project", "post", { itemId: item.id });
      setCurrentProject(r.projectId);
      setPendingAutoRun(true);
      navigate("/canvas");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-black hover:brightness-110 disabled:opacity-40"
          disabled={!props.canFetch || busy}
          onClick={refresh}
        >
          {iconRefresh({ width: 12, height: 12 })}
          {busy ? "正在问模型…" : "刷新热点"}
        </button>
        <button
          className={`rounded-md px-2.5 py-1 text-[11px] ${platform === "" ? "bg-panel-2 text-accent" : "text-fg-dim hover:text-fg"}`}
          onClick={() => setPlatform("")}
        >
          全部
        </button>
        {platforms.map((p) => (
          <button
            key={p}
            className={`rounded-md px-2.5 py-1 text-[11px] ${platform === p ? "bg-panel-2 text-accent" : "text-fg-dim hover:text-fg"}`}
            onClick={() => setPlatform(p)}
          >
            {p}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-fg-faint">热度 = AI 估计</span>
      </div>
      {error && <div className="mb-3 rounded-lg bg-red-950/30 px-3 py-2 text-xs text-red-300">{error}</div>}

      {items && items.length === 0 && (
        <div className="rounded-xl border border-dashed border-line py-16 text-center text-sm text-fg-faint">
          还没有热点。配好联网文本模型后点「刷新热点」。
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {items?.map((it) => (
          <article
            key={it.id}
            className={`rounded-xl border bg-panel p-4 ${highlight === it.id ? "border-accent" : "border-line"}`}
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] text-sky-300">{it.platform}</span>
              <span className="text-[10px] text-fg-faint" title="AI 估计">
                热度 {it.heat}
                {it.heatText ? ` · ${it.heatText}` : ""}
              </span>
            </div>
            <h3 className="text-sm font-medium leading-snug">{it.title}</h3>
            {it.summary && <p className="mt-1.5 text-xs leading-relaxed text-fg-dim">{it.summary}</p>}
            <div className="mt-3 flex items-center gap-2">
              <button
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-black hover:brightness-110"
                onClick={() => makeVideo(it)}
              >
                做成视频
              </button>
              {it.url && (
                <a className="text-[11px] text-fg-faint underline hover:text-fg" href={it.url} target="_blank" rel="noreferrer">
                  原文
                </a>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function WatchPane() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const { data: subs } = useQuery({ queryKey: ["radar-subs"], queryFn: () => api<RadarSub[]>("/api/radar/subs") });
  const { data: sources } = useQuery({ queryKey: ["radar-sources"], queryFn: () => api<RadarSource[]>("/api/radar/sources") });
  const { data: channels } = useQuery({ queryKey: ["push-channels"], queryFn: () => api<PushChannel[]>("/api/push/channels") });

  const toggleSrc = useMutation({
    mutationFn: (s: RadarSource) => apiJson(`/api/radar/sources/${s.id}`, "patch", { enabled: !s.enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["radar-sources"] }),
  });
  const intervalMut = useMutation({
    mutationFn: (s: { id: string; intervalMinutes: number }) =>
      apiJson(`/api/radar/sources/${s.id}`, "patch", { intervalMinutes: s.intervalMinutes }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["radar-sources"] }),
  });
  const delSub = useMutation({
    mutationFn: (id: string) => apiJson(`/api/radar/subs/${id}`, "delete"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["radar-subs"] }),
  });

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-medium text-fg-faint">观察哪些平台</h2>
        </div>
        <div className="space-y-2">
          {sources?.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-panel px-3 py-2.5">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="accent-amber-400" checked={s.enabled} onChange={() => toggleSrc.mutate(s)} />
                {s.name}
              </label>
              <select
                className="ml-auto rounded-md border border-line bg-panel-2 px-2 py-1 text-[11px] text-fg-dim"
                value={s.intervalMinutes}
                onChange={(e) => intervalMut.mutate({ id: s.id, intervalMinutes: Number(e.target.value) })}
              >
                {intervalPresets.map((p) => (
                  <option key={p.minutes} value={p.minutes}>{p.label}</option>
                ))}
              </select>
              {s.lastError && <span className="w-full text-[10px] text-red-400">{s.lastError}</span>}
            </div>
          ))}
        </div>
        <AddSourceInline />
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-medium text-fg-faint">关键词订阅 · 命中就推送</h2>
          <button className="flex items-center gap-1 text-xs text-accent" onClick={() => setAdding(true)}>
            {iconPlus({ width: 12, height: 12 })} 加关注
          </button>
        </div>
        {subs?.length === 0 && <p className="text-xs text-fg-faint">还没盯任何词。加一个「武松」之类，热了就会通知你。</p>}
        <div className="space-y-2">
          {subs?.map((s) => (
            <div key={s.id} className="flex items-center gap-3 rounded-xl border border-line bg-panel px-3 py-2.5 text-sm">
              <span className="font-medium">{s.keyword}</span>
              <span className="text-[11px] text-fg-faint">
                热度≥{s.heatThreshold}
                {s.platforms.length ? ` · ${s.platforms.join("、")}` : " · 全平台"}
                {s.quietStart !== null && s.quietEnd !== null ? ` · 免打扰 ${s.quietStart}:00–${s.quietEnd}:00` : ""}
              </span>
              <button className="ml-auto text-fg-faint hover:text-red-400" onClick={() => delSub.mutate(s.id)}>
                {iconTrash({ width: 12, height: 12 })}
              </button>
            </div>
          ))}
        </div>
      </section>

      {adding && (
        <SubModal
          platforms={[...new Set((sources ?? []).map((s) => s.platform))]}
          channels={channels ?? []}
          onClose={() => setAdding(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["radar-subs"] });
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}

function AddSourceInline() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const mut = useMutation({
    mutationFn: () => apiJson("/api/radar/sources", "post", { name, focus: name }),
    onSuccess: () => {
      setName("");
      qc.invalidateQueries({ queryKey: ["radar-sources"] });
    },
  });
  return (
    <form
      className="mt-3 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) mut.mutate();
      }}
    >
      <input
        className="flex-1 rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-xs outline-none focus:border-accent-dim"
        placeholder="再加一个领域，比如「电商」「AI」"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button className="rounded-lg border border-line px-3 py-1.5 text-xs text-fg-dim hover:text-fg" disabled={!name.trim()}>
        添加观察
      </button>
    </form>
  );
}

function SubModal(props: {
  platforms: string[];
  channels: PushChannel[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [heat, setHeat] = useState(60);
  const [plats, setPlats] = useState<string[]>([]);
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [quiet, setQuiet] = useState(false);
  const [error, setError] = useState("");
  const mut = useMutation({
    mutationFn: () =>
      apiJson("/api/radar/subs", "post", {
        keyword,
        heatThreshold: heat,
        platforms: plats,
        channelIds,
        quietStart: quiet ? 22 : null,
        quietEnd: quiet ? 8 : null,
      }),
    onSuccess: props.onSaved,
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });
  return (
    <Modal title="加一个关注" onClose={props.onClose} width="w-[420px]">
      <div className="space-y-3">
        <input
          autoFocus
          className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent-dim"
          placeholder="关键词，例如：武松"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <label className="block text-xs text-fg-dim">
          最低热度 {heat}
          <input type="range" min={0} max={100} value={heat} onChange={(e) => setHeat(Number(e.target.value))} className="mt-1 w-full accent-amber-400" />
        </label>
        <div className="flex flex-wrap gap-1.5">
          {props.platforms.map((p) => (
            <button
              key={p}
              type="button"
              className={`rounded-full px-2.5 py-0.5 text-[11px] ${plats.includes(p) ? "bg-accent text-black" : "border border-line text-fg-dim"}`}
              onClick={() => setPlats((xs) => (xs.includes(p) ? xs.filter((x) => x !== p) : [...xs, p]))}
            >
              {p}
            </button>
          ))}
          <span className="text-[10px] text-fg-faint">不选 = 全平台</span>
        </div>
        {props.channels.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {props.channels.map((ch) => (
              <button
                key={ch.id}
                type="button"
                className={`rounded-full px-2.5 py-0.5 text-[11px] ${channelIds.includes(ch.id) ? "bg-accent text-black" : "border border-line text-fg-dim"}`}
                onClick={() => setChannelIds((xs) => (xs.includes(ch.id) ? xs.filter((x) => x !== ch.id) : [...xs, ch.id]))}
              >
                {ch.name}
              </button>
            ))}
            <span className="text-[10px] text-fg-faint">不选 = 发给所有渠道</span>
          </div>
        )}
        <label className="flex items-center gap-2 text-xs text-fg-dim">
          <input type="checkbox" className="accent-amber-400" checked={quiet} onChange={(e) => setQuiet(e.target.checked)} />
          晚上 22 点到早上 8 点别吵我
        </label>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="rounded-lg border border-line px-3 py-1.5 text-sm text-fg-dim" onClick={props.onClose}>取消</button>
          <button
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-black disabled:opacity-40"
            disabled={!keyword.trim() || mut.isPending}
            onClick={() => mut.mutate()}
          >
            保存
          </button>
        </div>
      </div>
    </Modal>
  );
}

function PushPane() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const { data: channels } = useQuery({ queryKey: ["push-channels"], queryFn: () => api<PushChannel[]>("/api/push/channels") });
  const { data: logs } = useQuery({ queryKey: ["push-logs"], queryFn: () => api<PushLog[]>("/api/push/logs") });
  const { data: settings } = useQuery({ queryKey: ["radar-settings"], queryFn: () => api<RadarSettings>("/api/radar/settings") });

  const del = useMutation({
    mutationFn: (id: string) => apiJson(`/api/push/channels/${id}`, "delete"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["push-channels"] }),
  });
  const test = useMutation({
    mutationFn: (id: string) => apiJson(`/api/push/channels/${id}/test`, "post"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["push-logs"] }),
  });
  const digest = useMutation({
    mutationFn: (patch: Partial<RadarSettings>) => apiJson("/api/radar/settings", "put", patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["radar-settings"] }),
  });

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-medium text-fg-faint">推送渠道</h2>
          <button className="flex items-center gap-1 text-xs text-accent" onClick={() => setAdding(true)}>
            {iconPlus({ width: 12, height: 12 })} 添加
          </button>
        </div>
        {channels?.length === 0 && (
          <p className="text-xs text-fg-faint">加一个 Telegram 或 Server酱，关键词命中就会通知你。点推送里的链接能直接开做视频。</p>
        )}
        <div className="space-y-2">
          {channels?.map((ch) => (
            <div key={ch.id} className="flex items-center gap-3 rounded-xl border border-line bg-panel px-3 py-2.5">
              <div>
                <div className="text-sm">{ch.name}</div>
                <div className="text-[10px] text-fg-faint">{pushChannelLabels[ch.type]}</div>
              </div>
              <div className="ml-auto flex gap-1">
                <button
                  className="rounded-md border border-line px-2 py-1 text-[11px] text-fg-dim hover:text-accent disabled:opacity-40"
                  disabled={test.isPending}
                  onClick={() => test.mutate(ch.id)}
                >
                  试发一条
                </button>
                <button className="text-fg-faint hover:text-red-400" onClick={() => del.mutate(ch.id)}>
                  {iconTrash({ width: 12, height: 12 })}
                </button>
              </div>
            </div>
          ))}
        </div>
        {test.isError && <p className="mt-2 text-xs text-red-400">{test.error.message}</p>}
      </section>

      <section className="rounded-xl border border-line bg-panel px-4 py-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-amber-400"
            checked={!!settings?.digestEnabled}
            onChange={(e) => digest.mutate({ digestEnabled: e.target.checked })}
          />
          每天早报
        </label>
        {settings?.digestEnabled && (
          <label className="mt-2 flex items-center gap-2 text-xs text-fg-dim">
            几点发
            <input
              type="number"
              min={0}
              max={23}
              className="w-16 rounded-md border border-line bg-panel-2 px-2 py-1"
              value={settings.digestHour}
              onChange={(e) => digest.mutate({ digestHour: Number(e.target.value) })}
            />
            点（本机时间）
          </label>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-xs font-medium text-fg-faint">最近推送</h2>
        {logs?.length === 0 && <p className="text-xs text-fg-faint">还没有推送记录</p>}
        <div className="space-y-1.5">
          {logs?.map((l) => (
            <div key={l.id} className="flex items-center gap-2 text-[11px] text-fg-dim">
              <span className={l.status === "sent" ? "text-emerald-400" : "text-red-400"}>{l.status === "sent" ? "已发" : "失败"}</span>
              <span className="truncate">{l.title}</span>
              {l.error && <span className="truncate text-red-400">{l.error}</span>}
            </div>
          ))}
        </div>
      </section>

      {adding && (
        <ChannelModal
          onClose={() => setAdding(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["push-channels"] });
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}

function ChannelModal(props: { onClose: () => void; onSaved: () => void }) {
  const { data: types } = useQuery({
    queryKey: ["push-types"],
    queryFn: () =>
      api<Array<{ type: PushChannelType; label: string; fields: Array<{ key: string; label: string; secret?: boolean; placeholder: string }> }>>(
        "/api/push/types",
      ),
  });
  const [type, setType] = useState<PushChannelType>("telegram");
  const [name, setName] = useState("");
  const [config, setConfig] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const spec = types?.find((t) => t.type === type);
  const mut = useMutation({
    mutationFn: () => apiJson("/api/push/channels", "post", { type, name, config }),
    onSuccess: props.onSaved,
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });
  return (
    <Modal title="添加推送渠道" onClose={props.onClose} width="w-[420px]">
      <div className="space-y-3">
        <select
          className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm"
          value={type}
          onChange={(e) => setType(e.target.value as PushChannelType)}
        >
          {types?.map((t) => (
            <option key={t.type} value={t.type}>{t.label}</option>
          ))}
        </select>
        <input
          className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent-dim"
          placeholder="名称，例如：我的 Telegram"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {spec?.fields.map((f) => (
          <input
            key={f.key}
            type={f.secret ? "password" : "text"}
            className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent-dim"
            placeholder={f.label + " · " + f.placeholder}
            value={config[f.key] ?? ""}
            onChange={(e) => setConfig((m) => ({ ...m, [f.key]: e.target.value }))}
          />
        ))}
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="rounded-lg border border-line px-3 py-1.5 text-sm text-fg-dim" onClick={props.onClose}>取消</button>
          <button
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-black disabled:opacity-40"
            disabled={!name.trim() || mut.isPending}
            onClick={() => mut.mutate()}
          >
            保存
          </button>
        </div>
      </div>
    </Modal>
  );
}
