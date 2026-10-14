import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  capabilityLabels,
  customWorkflowHint,
  isLocalBaseUrl,
  matchPreset,
  missingUnitPrice,
  modelPresets,
  needsCustomWorkflow,
  validateComfyConfig,
  type Capability,
  type FieldSpec,
  type ModelEndpoint,
  type ModelPreset,
  type PriceQuote,
  type TestResult,
  voicesForConfig,
} from "@vw/models";
import { api, apiJson } from "../lib/api";
import { iconChevron, iconPlus, iconTrash } from "../lib/icons";
import { confirmDanger } from "../lib/prefs";
import { Modal } from "../components/modal";

interface AdapterMeta {
  type: string;
  label: string;
  capabilities: Capability[];
  configFields: FieldSpec[];
}

const capabilities: Capability[] = ["llm", "image", "video", "tts"];

type PriceStatus = { ok: true; quote?: PriceQuote } | { ok: false; reason: string };
type SavedEndpoint = ModelEndpoint & { priceStatus?: PriceStatus };

interface UsageSummary {
  totalCost: number;
  totalCalls: number;
  promptTokens: number;
  completionTokens: number;
  images: number;
  audioChars: number;
  byEndpoint: Array<{
    endpointId: string;
    name: string;
    capability: Capability;
    calls: number;
    promptTokens: number;
    completionTokens: number;
    images: number;
    cost: number;
  }>;
  byDay: Array<{ date: string; calls: number; cost: number }>;
}

export function ModelsPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<ModelEndpoint | "new" | null>(null);
  const [adding, setAdding] = useState<ModelPreset | null>(null);
  const [priceWarn, setPriceWarn] = useState("");
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({
    presets: true,
    local: true,
    usage: true,
  });
  const [priceMsg, setPriceMsg] = useState("");

  const { data: adapters } = useQuery({
    queryKey: ["model-adapters"],
    queryFn: () => api<AdapterMeta[]>("/api/models/adapters"),
    staleTime: Infinity,
  });

  const { data: endpoints } = useQuery({
    queryKey: ["model-endpoints"],
    queryFn: () => api<ModelEndpoint[]>("/api/models/endpoints"),
  });
  const { data: usage } = useQuery({
    queryKey: ["model-usage"],
    queryFn: () => api<UsageSummary>("/api/models/usage?days=30"),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["model-endpoints"] });
    queryClient.invalidateQueries({ queryKey: ["model-usage"] });
  };

  const syncPrices = useMutation({
    mutationFn: () =>
      apiJson<{
        filled: Array<{ name: string; model: string }>;
        skipped: Array<{ name: string; reason: string }>;
      }>("/api/models/prices/sync", "post"),
    onSuccess: (r) => {
      invalidate();
      const ok = r.filled.length ? `已写入 ${r.filled.map((x) => x.name).join("、")}` : "";
      const no = r.skipped.length
        ? `${r.skipped.map((x) => `${x.name}：${x.reason}`).join("；")}`
        : "";
      setPriceMsg([ok, no].filter(Boolean).join("。") || "没有可拉的渠道");
    },
    onError: (e) => setPriceMsg(e instanceof Error ? e.message : String(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiJson(`/api/models/endpoints/${id}`, "delete"),
    onSuccess: invalidate,
  });
  const defaultMutation = useMutation({
    mutationFn: (id: string) => apiJson(`/api/models/endpoints/${id}/default`, "post"),
    onSuccess: invalidate,
  });
  const toggleMutation = useMutation({
    mutationFn: (ep: ModelEndpoint) => apiJson(`/api/models/endpoints/${ep.id}`, "patch", { enabled: !ep.enabled }),
    onSuccess: invalidate,
  });
  const testMutation = useMutation({
    mutationFn: (id: string) => apiJson<TestResult>(`/api/models/endpoints/${id}/test`, "post"),
    onSuccess: (result, id) => setTestResults((m) => ({ ...m, [id]: result })),
  });

  const grouped = useMemo(() => {
    const map = new Map<Capability, ModelEndpoint[]>();
    for (const cap of capabilities) map.set(cap, []);
    for (const ep of endpoints ?? []) map.get(ep.capability)?.push(ep);
    return map;
  }, [endpoints]);

  const presetsByCap = useMemo(() => {
    const map = new Map<Capability, ModelPreset[]>();
    for (const cap of capabilities) map.set(cap, []);
    for (const p of modelPresets.filter((x) => !x.local)) map.get(p.capability)?.push(p);
    return map;
  }, []);

  const localByCap = useMemo(() => {
    const map = new Map<Capability, ModelPreset[]>();
    for (const cap of capabilities) map.set(cap, []);
    for (const p of modelPresets.filter((x) => x.local)) map.get(p.capability)?.push(p);
    return map;
  }, []);

  const isOpen = (key: string, fallback: boolean) => open[key] ?? fallback;
  const toggle = (key: string, fallback: boolean) =>
    setOpen((m) => ({ ...m, [key]: !(m[key] ?? fallback) }));

  return (
    <div className="max-w-3xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">模型</h1>
          <p className="mt-0.5 text-xs text-fg-faint">
            云端点一下填密钥。本机 Ollama、LM Studio、ComfyUI 是可选项，填地址就能接。
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="rounded-lg border border-line px-3 py-2 text-xs text-fg-dim hover:text-fg"
            onClick={async () => {
              const r = await apiJson<{ created: string[]; skipped: string[] }>("/api/models/import-env", "post");
              invalidate();
              alert(
                r.created.length
                  ? `已从环境变量加上：${r.created.join("、")}`
                  : r.skipped[0] || "没有可导入的环境变量",
              );
            }}
          >
            从环境变量导入
          </button>
          <button
            className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs text-fg-dim hover:text-fg"
            onClick={() => setEditing("new")}
          >
            {iconPlus({ width: 12, height: 12 })} 自定义
          </button>
        </div>
      </div>

      {usage && (
        <Fold
          title="近 30 天花费"
          open={isOpen("usage", true)}
          onToggle={() => toggle("usage", true)}
          extra={`¥${usage.totalCost.toFixed(2)}`}
        >
          <div className="flex flex-wrap gap-6">
            <div>
              <div className="text-2xl font-semibold tabular-nums">¥{usage.totalCost.toFixed(2)}</div>
              <div className="text-[11px] text-fg-faint">加上模型时会向渠道要报价。拉不到就要手填，否则这里是 0。</div>
            </div>
            <div className="text-xs text-fg-dim">
              <div>{usage.totalCalls} 次调用</div>
              <div>{usage.promptTokens + usage.completionTokens} tokens</div>
              <div>
                {usage.images} 张图 · {usage.audioChars} 字配音
              </div>
            </div>
          </div>
          {usage.byEndpoint.length > 0 && (
            <div className="mt-3 space-y-1">
              {usage.byEndpoint.map((row) => (
                <div key={row.endpointId || row.name} className="flex justify-between text-[11px] text-fg-dim">
                  <span>
                    {row.name} · {capabilityLabels[row.capability]} · {row.calls} 次
                  </span>
                  <span className="tabular-nums">¥{Number(row.cost).toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </Fold>
      )}

      <Fold
        title="本机"
        open={isOpen("local", true)}
        onToggle={() => toggle("local", true)}
        extra="可选项，不填密钥"
      >
        <p className="mb-3 text-[11px] text-fg-faint">
          Ollama / LM Studio 填地址即可。ComfyUI：SD1.5 / SDXL 选模型就能出图；Flux 等必须再贴 Save (API Format) 工作流。
        </p>
        <div className="space-y-4">
          {capabilities.map((cap) => {
            const list = localByCap.get(cap) ?? [];
            if (list.length === 0) return null;
            return (
              <div key={cap}>
                <h3 className="mb-2 text-[11px] text-fg-faint">{capabilityLabels[cap]}</h3>
                <div className="flex flex-wrap gap-2">
                  {list.map((preset) => {
                    const existing = (endpoints ?? []).find((ep) => matchPreset(preset, ep));
                    return (
                      <button
                        key={preset.id}
                        className={`rounded-full border px-3 py-1.5 text-xs ${
                          existing
                            ? "border-accent/40 bg-accent/10 text-accent"
                            : "border-line text-fg-dim hover:border-accent-dim hover:text-fg"
                        }`}
                        onClick={() => (existing ? setEditing(existing) : setAdding(preset))}
                      >
                        {preset.name}
                        {existing ? " · 已加" : ""}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </Fold>

      <Fold
        title="常用模型"
        open={isOpen("presets", true)}
        onToggle={() => toggle("presets", true)}
        extra="点一下填密钥"
      >
        <div className="space-y-4">
          {capabilities.map((cap) => {
            const list = presetsByCap.get(cap) ?? [];
            if (list.length === 0) return null;
            return (
              <div key={cap}>
                <h3 className="mb-2 text-[11px] text-fg-faint">{capabilityLabels[cap]}</h3>
                <div className="flex flex-wrap gap-2">
                  {list.map((preset) => {
                    const existing = (endpoints ?? []).find((ep) => matchPreset(preset, ep));
                    return (
                      <button
                        key={preset.id}
                        className={`rounded-full border px-3 py-1.5 text-xs ${
                          existing
                            ? "border-accent/40 bg-accent/10 text-accent"
                            : "border-line text-fg-dim hover:border-accent-dim hover:text-fg"
                        }`}
                        onClick={() => (existing ? setEditing(existing) : setAdding(preset))}
                      >
                        {preset.name}
                        {existing ? " · 已加" : ""}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </Fold>

      <div className="mt-6 space-y-3">
        <h2 className="text-xs font-medium text-fg-faint">已配置</h2>
        {capabilities.map((cap) => {
          const list = grouped.get(cap) ?? [];
          const key = `cfg-${cap}`;
          const fallback = list.length > 0;
          return (
            <Fold
              key={cap}
              title={capabilityLabels[cap]}
              open={isOpen(key, fallback)}
              onToggle={() => toggle(key, fallback)}
              extra={endpoints == null ? "…" : list.length ? `${list.length} 个` : "还没有"}
            >
              {endpoints == null ? (
                <p className="text-xs text-fg-faint">加载中…</p>
              ) : list.length === 0 ? (
                <p className="text-xs text-fg-faint">还没加。上面点一个常用的，填密钥就行。</p>
              ) : (
                <div className="space-y-2">
                  {list.map((ep) => {
                    const test = testResults[ep.id];
                    return (
                      <div
                        key={ep.id}
                        className={`rounded-xl border bg-panel p-4 ${ep.enabled ? "border-line" : "border-line/50 opacity-55"}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{ep.name}</span>
                          {ep.isDefault && (
                            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] text-accent">默认</span>
                          )}
                          {ep.webSearch && (
                            <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] text-sky-400">联网</span>
                          )}
                          {ep.vision && (
                            <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] text-violet-400">看图</span>
                          )}
                          {(ep.adapterType === "comfyui" || isLocalBaseUrl(ep.config.baseUrl ?? "")) && (
                            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-400">本机</span>
                          )}
                          <span className="text-[11px] text-fg-faint">{ep.config.model}</span>
                          {missingUnitPrice(ep) && (
                            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-500">未填单价</span>
                          )}
                          <div className="ml-auto flex items-center gap-1">
                            <button
                              className="rounded-md border border-line px-2 py-1 text-[11px] text-fg-dim hover:text-accent disabled:opacity-40"
                              disabled={testMutation.isPending && testMutation.variables === ep.id}
                              onClick={() => testMutation.mutate(ep.id)}
                            >
                              {testMutation.isPending && testMutation.variables === ep.id ? "测…" : "测试"}
                            </button>
                            {!ep.isDefault && (
                              <button
                                className="rounded-md border border-line px-2 py-1 text-[11px] text-fg-dim hover:text-accent"
                                onClick={() => defaultMutation.mutate(ep.id)}
                              >
                                设为默认
                              </button>
                            )}
                            <button
                              className="rounded-md border border-line px-2 py-1 text-[11px] text-fg-dim hover:text-fg"
                              onClick={() => toggleMutation.mutate(ep)}
                            >
                              {ep.enabled ? "停用" : "启用"}
                            </button>
                            <button
                              className="rounded-md border border-line px-2 py-1 text-[11px] text-fg-dim hover:text-fg"
                              onClick={() => setEditing(ep)}
                            >
                              编辑
                            </button>
                            <button
                              className="rounded-md border border-line px-2 py-1 text-[11px] text-fg-dim hover:text-red-400"
                              onClick={() => {
                                if (confirmDanger(`删除端点「${ep.name}」？`)) deleteMutation.mutate(ep.id);
                              }}
                            >
                              {iconTrash({ width: 12, height: 12 })}
                            </button>
                          </div>
                        </div>
                        <div className="mt-1.5 font-mono text-[11px] text-fg-faint">
                          {ep.config.baseUrl} · key {ep.config.apiKey ?? ep.config.accessKey ?? "未设置"}
                        </div>
                        {test && (
                          <div
                            className={`mt-2 rounded-lg px-3 py-1.5 text-[11px] ${
                              test.ok ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
                            }`}
                          >
                            {test.ok ? `连接成功 · ${test.latencyMs}ms` : `失败：${test.message}`}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Fold>
          );
        })}
      </div>

      {adding && (
        <PresetKeyModal
          preset={adding}
          onClose={() => setAdding(null)}
          onSaved={(data) => {
            invalidate();
            queryClient.invalidateQueries({ queryKey: ["model-usage"] });
            setAdding(null);
            if (data.priceStatus && data.priceStatus.ok === false) {
              setPriceWarn(data.priceStatus.reason);
              setEditing(data);
            }
          }}
        />
      )}

      {editing && adapters && (
        <EndpointModal
          adapters={adapters}
          endpoint={editing === "new" ? null : editing}
          warn={priceWarn}
          onClose={() => {
            setEditing(null);
            setPriceWarn("");
          }}
          onSaved={(data) => {
            invalidate();
            queryClient.invalidateQueries({ queryKey: ["model-usage"] });
            if (editing === "new" && data.priceStatus && data.priceStatus.ok === false) {
              setPriceWarn(data.priceStatus.reason);
              setEditing(data);
              return;
            }
            setEditing(null);
            setPriceWarn("");
          }}
        />
      )}
    </div>
  );
}

function Fold(props: {
  title: string;
  extra?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="mb-3 rounded-xl border border-line bg-panel">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
        onClick={props.onToggle}
      >
        <span className={`text-fg-faint transition-transform ${props.open ? "" : "-rotate-90"}`}>
          {iconChevron({ width: 14, height: 14 })}
        </span>
        <span className="text-xs font-medium">{props.title}</span>
        {props.extra ? <span className="ml-auto text-[11px] text-fg-faint">{props.extra}</span> : null}
      </button>
      {props.open ? <div className="border-t border-line px-4 py-3">{props.children}</div> : null}
    </section>
  );
}

function fieldControl(
  f: { key: string; type?: string; placeholder?: string },
  value: string,
  onChange: (v: string) => void,
) {
  const cls = "w-full rounded-lg border border-line bg-panel-2 px-3 py-2 font-mono text-xs outline-none focus:border-accent-dim";
  if (f.type === "textarea" || f.key === "workflow") {
    return (
      <textarea
        rows={8}
        className={`${cls} min-h-[140px] resize-y`}
        placeholder={f.placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <input
      type={f.type === "password" ? "password" : "text"}
      className={cls}
      placeholder={f.placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function ProbeModels(props: {
  adapterType: string;
  config: Record<string, string>;
  onPick: (id: string) => void;
}) {
  const [models, setModels] = useState<string[]>([]);
  const [error, setError] = useState("");
  const current = props.config.model?.trim() ?? "";
  const comfy = props.adapterType === "comfyui";
  const probe = useMutation({
    mutationFn: () =>
      apiJson<{ models: string[] }>("/api/models/probe", "post", {
        adapterType: props.adapterType,
        config: props.config,
      }),
    onSuccess: (r) => {
      setModels(r.models);
      setError("");
      // 旧配置若已不在列表里，清掉，避免保存后继续跑挂
      if (current && !r.models.includes(current)) props.onPick("");
      else if (!current && r.models.length === 1) props.onPick(r.models[0]!);
    },
    onError: (e) => {
      setModels([]);
      setError(e instanceof Error ? e.message : String(e));
    },
  });
  const options = models.length
    ? models
    : current
      ? [current]
      : [];
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs text-fg-dim">{comfy ? "本机模型" : "探测本机模型"}</label>
        <button
          type="button"
          className="rounded-md border border-line px-2 py-1 text-[11px] text-fg-dim hover:text-accent disabled:opacity-40"
          disabled={probe.isPending || !props.config.baseUrl?.trim()}
          onClick={() => probe.mutate()}
        >
          {probe.isPending ? "探测中…" : models.length || current ? "重新探测" : "探测本机模型"}
        </button>
      </div>
      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
      {options.length > 0 ? (
        <select
          className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 font-mono text-xs outline-none"
          value={current}
          onChange={(e) => props.onPick(e.target.value)}
        >
          <option value="">{comfy ? "请选择一个模型" : `从 ${options.length} 个里选一个`}</option>
          {options.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      ) : (
        <p className="text-[11px] text-fg-faint">
          {comfy ? "点「探测本机模型」，从本机可用列表里选一个。" : "点探测后可从列表里选。"}
        </p>
      )}
    </div>
  );
}

const EDIT_FIELDS: Record<string, { label: string; type?: "text" | "textarea"; placeholder?: string }> = {
  baseUrl: { label: "地址", placeholder: "http://127.0.0.1:11434/v1" },
  model: { label: "模型名", placeholder: "点探测从本机列表选" },
  workflow: {
    label: "工作流 JSON（API Format）",
    type: "textarea",
    placeholder: "在 ComfyUI 菜单选 Save (API Format)，整段 JSON 贴到这里。可用 {{prompt}}。",
  },
};

function ComfyWorkflowGuide(props: { model: string; required: boolean; filled: boolean }) {
  if (!props.required) {
    return (
      <p className="mt-1 text-[11px] text-fg-faint">
        SD1.5 / SDXL 整包模型可不贴。Flux、视频等需要专用流程时，再从 ComfyUI 导出 API Format。
      </p>
    );
  }
  if (props.filled) {
    return <p className="mt-1 text-[11px] text-emerald-500">已贴工作流，可以保存。</p>;
  }
  const name = props.model.trim().split(/[/\\]/).pop() || "当前模型";
  return (
    <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
      <p className="font-medium text-amber-300">「{name}」必须贴工作流，否则无法保存、也无法出图。</p>
      <ol className="mt-1.5 list-decimal space-y-0.5 pl-4 text-amber-100/90">
        <li>在 ComfyUI 里打开能跑通这个模型的文生图流程</li>
        <li>菜单选 Save (API Format)</li>
        <li>把整段 JSON 贴到上面输入框</li>
      </ol>
    </div>
  );
}

function PresetKeyModal(props: { preset: ModelPreset; onClose: () => void; onSaved: (data: SavedEndpoint) => void }) {
  const p = props.preset;
  const [secrets, setSecrets] = useState<Record<string, string>>(() =>
    Object.fromEntries(p.secretKeys.map((k) => [k, ""])),
  );
  const [extra, setExtra] = useState<Record<string, string>>(() => ({ ...p.config }));
  const [optionalKey, setOptionalKey] = useState("");
  const [error, setError] = useState("");

  const needModel = p.adapterType !== "comfyui";
  const workflowRequired =
    p.id === "comfyui-video" || (p.adapterType === "comfyui" && needsCustomWorkflow(extra.model ?? ""));
  const readySecrets = p.secretKeys.every((k) => Boolean(secrets[k]?.trim()));
  const readyLocal =
    Boolean(extra.baseUrl?.trim()) &&
    (!needModel || Boolean(extra.model?.trim())) &&
    (!workflowRequired || Boolean(extra.workflow?.trim())) &&
    (p.id !== "comfyui-image" || Boolean(extra.model?.trim() || extra.workflow?.trim()));
  const canSave = readySecrets && (p.local ? readyLocal : true);

  const saveMutation = useMutation({
    mutationFn: async () => {
      for (const key of p.secretKeys) {
        if (!secrets[key]?.trim()) {
          throw new Error(`先填${p.secretLabels?.[key] ?? (key === "apiKey" ? "API Key" : key)}`);
        }
      }
      if (p.local && !extra.baseUrl?.trim()) throw new Error("先填本机地址");
      if (needModel && !extra.model?.trim()) throw new Error("先填模型名，或点探测从列表选");
      if (p.adapterType === "comfyui") {
        const bad = validateComfyConfig(
          { ...p.config, ...extra, ...(optionalKey.trim() ? { apiKey: optionalKey.trim() } : {}) },
          p.capability,
        );
        if (bad) throw new Error(bad);
      }
      const config = { ...p.config, ...extra, ...secrets };
      if (p.local && optionalKey.trim()) config.apiKey = optionalKey.trim();
      return apiJson<SavedEndpoint>("/api/models/endpoints", "post", {
        name: p.name,
        adapterType: p.adapterType,
        capability: p.capability,
        config,
        webSearch: p.webSearch ?? false,
        vision: p.vision ?? false,
      });
    },
    onSuccess: (data) => props.onSaved(data),
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  return (
    <Modal title={`添加 ${p.name}`} onClose={props.onClose} width={p.local ? "w-[560px]" : "w-[440px]"}>
      <div className="space-y-4">
        <p className="text-xs text-fg-dim">{p.hint}</p>
        {p.local ? (
          <p className="text-[11px] text-fg-faint">这是可选项。本机没开服务也能先不加，开了再来填地址。</p>
        ) : (
          <p className="text-[11px] text-fg-faint">加上后会向渠道要报价。拉不到会让你手填，不然近 30 天花费是 0。</p>
        )}
        {(p.editKeys ?? [])
          .filter((key) => !(p.adapterType === "comfyui" && (key === "model" || key === "workflow")))
          .map((key) => {
          const meta = EDIT_FIELDS[key] ?? { label: key };
          return (
            <div key={key}>
              <label className="mb-1.5 block text-xs text-fg-dim">
                {meta.label}
                {(key === "baseUrl" || (needModel && key === "model")) && (
                  <span className="text-red-400"> *</span>
                )}
              </label>
              {fieldControl(
                { key, type: meta.type, placeholder: meta.placeholder },
                extra[key] ?? "",
                (v) => setExtra((m) => ({ ...m, [key]: v })),
              )}
            </div>
          );
        })}
        {p.local ? (
          <ProbeModels
            adapterType={p.adapterType}
            config={{ ...extra, ...secrets, ...(optionalKey.trim() ? { apiKey: optionalKey.trim() } : {}) }}
            onPick={(id) => setExtra((m) => ({ ...m, model: id }))}
          />
        ) : null}
        {p.adapterType === "comfyui" ? (
          <div>
            <label className="mb-1.5 block text-xs text-fg-dim">
              工作流 JSON（API Format）
              {workflowRequired && <span className="text-red-400"> *</span>}
            </label>
            {fieldControl(
              { key: "workflow", type: "textarea", placeholder: EDIT_FIELDS.workflow!.placeholder },
              extra.workflow ?? "",
              (v) => setExtra((m) => ({ ...m, workflow: v })),
            )}
            <ComfyWorkflowGuide
              model={extra.model ?? ""}
              required={workflowRequired}
              filled={Boolean(extra.workflow?.trim())}
            />
          </div>
        ) : null}
        {p.local && p.adapterType === "openai-compatible" ? (
          <div>
            <label className="mb-1.5 block text-xs text-fg-dim">API Key（没有就空着）</label>
            <input
              type="password"
              className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 font-mono text-xs outline-none focus:border-accent-dim"
              placeholder="Ollama / LM Studio 通常不需要"
              value={optionalKey}
              onChange={(e) => setOptionalKey(e.target.value)}
            />
          </div>
        ) : null}
        {p.secretKeys.map((key) => (
          <div key={key}>
            <label className="mb-1.5 block text-xs text-fg-dim">
              {p.secretLabels?.[key] ?? (key === "apiKey" ? "API Key" : key)}
              <span className="text-red-400"> *</span>
            </label>
            <input
              autoFocus={key === p.secretKeys[0]}
              type="password"
              className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 font-mono text-xs outline-none focus:border-accent-dim"
              placeholder="贴密钥"
              value={secrets[key] ?? ""}
              onChange={(e) => setSecrets((m) => ({ ...m, [key]: e.target.value }))}
            />
          </div>
        ))}
        {error && <div className="text-xs text-red-400">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className="rounded-lg border border-line px-4 py-1.5 text-sm text-fg-dim hover:bg-panel-2" onClick={props.onClose}>
            取消
          </button>
          <button
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-black hover:brightness-110 disabled:opacity-40"
            disabled={saveMutation.isPending || !canSave}
            title={
              workflowRequired && !extra.workflow?.trim()
                ? "先贴工作流再保存"
                : !extra.model?.trim() && p.adapterType === "comfyui"
                  ? "先探测并选一个模型"
                  : undefined
            }
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? (p.local ? "加上…" : "加上并拉报价…") : "加上"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function EndpointModal(props: {
  adapters: AdapterMeta[];
  endpoint: ModelEndpoint | null;
  warn?: string;
  onClose: () => void;
  onSaved: (data: SavedEndpoint) => void;
}) {
  const ep = props.endpoint;
  const [name, setName] = useState(ep?.name ?? "");
  const [capability, setCapability] = useState<Capability>(ep?.capability ?? "llm");
  const [adapterType, setAdapterType] = useState(ep?.adapterType ?? props.adapters[0]?.type ?? "");
  const [config, setConfig] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    const initialAdapter = ep?.adapterType ?? props.adapters[0]?.type;
    for (const f of props.adapters.find((a) => a.type === initialAdapter)?.configFields ?? []) {
      if (ep && (f.type === "password" || f.key === "apiKey" || f.key === "secretKey")) {
        init[f.key] = "";
      } else {
        init[f.key] = ep?.config[f.key] ?? f.defaultValue ?? "";
      }
    }
    for (const k of ["priceInput", "priceOutput", "priceImage", "priceTts", "priceVideo", "voice"] as const) {
      if (ep?.config[k]) init[k] = ep.config[k]!;
    }
    // 历史误存的非权重文件不展示，逼用户重新从探测列表选
    if (initialAdapter === "comfyui" && init.model && !/\.(safetensors|ckpt|pt|pth|bin|gguf)$/i.test(init.model)) {
      init.model = "";
    }
    return init;
  });
  const [webSearch, setWebSearch] = useState(ep?.webSearch ?? false);
  const [vision, setVision] = useState(ep?.vision ?? false);
  const [error, setError] = useState(
    props.warn ? `渠道拉不到报价：${props.warn}。单价请手填，不然花费是 0。` : "",
  );

  const adapter = props.adapters.find((a) => a.type === adapterType);
  const adaptersForCap = props.adapters.filter((a) => a.capabilities.includes(capability));
  const localish = adapterType === "comfyui" || isLocalBaseUrl(config.baseUrl ?? "");

  useEffect(() => {
    if (ep) return;
    if (!adaptersForCap.some((a) => a.type === adapterType)) {
      const next = adaptersForCap[0]?.type ?? "";
      setAdapterType(next);
      const a = props.adapters.find((x) => x.type === next);
      if (!a) return;
      setConfig((m) => {
        const merged = { ...m };
        for (const f of a.configFields) {
          if (!(merged[f.key] ?? "").trim() && f.defaultValue) merged[f.key] = f.defaultValue;
        }
        return merged;
      });
    }
  }, [capability]);

  useEffect(() => {
    if (!ep || !missingUnitPrice(ep)) return;
    let cancelled = false;
    void apiJson<{ quote: PriceQuote }>(`/api/models/endpoints/${ep.id}/prices`, "post")
      .then((r) => {
        if (cancelled || !r.quote) return;
        setConfig((m) => ({
          ...m,
          ...(r.quote.priceInput ? { priceInput: r.quote.priceInput } : {}),
          ...(r.quote.priceOutput ? { priceOutput: r.quote.priceOutput } : {}),
          ...(r.quote.priceImage ? { priceImage: r.quote.priceImage } : {}),
          ...(r.quote.priceTts ? { priceTts: r.quote.priceTts } : {}),
          ...(r.quote.priceVideo ? { priceVideo: r.quote.priceVideo } : {}),
        }));
        setError("");
      })
      .catch((e) => {
        if (cancelled) return;
        setError(`渠道拉不到报价：${e instanceof Error ? e.message : String(e)}。单价请手填，不然花费是 0。`);
      });
    return () => {
      cancelled = true;
    };
  }, [ep?.id]);

  const workflowRequired =
    adapterType === "comfyui" && (capability === "video" || needsCustomWorkflow(config.model ?? ""));
  const canSaveEndpoint =
    Boolean(name.trim()) && !(workflowRequired && !config.workflow?.trim());

  const saveMutation = useMutation({
    mutationFn: async () => {
      const sent = { ...config };
      if (ep) {
        if (!sent.apiKey?.trim() || sent.apiKey.includes("…") || sent.apiKey.includes("...")) delete sent.apiKey;
        if (!sent.secretKey?.trim() || sent.secretKey.includes("…") || sent.secretKey.includes("...")) delete sent.secretKey;
      }
      if (adapterType === "comfyui") {
        if (!ep && !sent.baseUrl?.trim()) throw new Error("请填写 ComfyUI 地址");
        const bad = validateComfyConfig(sent, capability);
        if (bad) throw new Error(bad);
      }
      const payload: Record<string, unknown> = { name: name.trim(), config: sent, webSearch, vision };
      if (ep) {
        return apiJson<SavedEndpoint>(`/api/models/endpoints/${ep.id}`, "patch", payload);
      }
      return apiJson<SavedEndpoint>("/api/models/endpoints", "post", {
        ...payload,
        adapterType,
        capability,
      });
    },
    onSuccess: (data) => {
      if (data.priceStatus && data.priceStatus.ok === false) {
        setError(`渠道拉不到报价：${data.priceStatus.reason}。单价请手填，不然花费是 0。`);
      }
      props.onSaved(data);
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  return (
    <Modal title={ep ? `编辑端点 · ${ep.name}` : "自定义模型"} onClose={props.onClose}>
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs text-fg-dim">
            名称<span className="text-red-400"> *</span>
          </label>
          <input
            autoFocus
            className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent-dim"
            placeholder="例如：本机 ComfyUI"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {!name.trim() && (
            <p className="mt-1 text-[11px] text-amber-500">先填名称，保存按钮才会亮起来。</p>
          )}
        </div>

        {!ep && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs text-fg-dim">能力</label>
              <select
                className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm outline-none"
                value={capability}
                onChange={(e) => setCapability(e.target.value as Capability)}
              >
                {capabilities.map((c) => (
                    <option key={c} value={c}>
                      {capabilityLabels[c]}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-fg-dim">适配器</label>
              <select
                className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm outline-none"
                value={adapterType}
                onChange={(e) => {
                  const next = e.target.value;
                  setAdapterType(next);
                  const a = props.adapters.find((x) => x.type === next);
                  if (!a) return;
                  setConfig((m) => {
                    const merged = { ...m };
                    for (const f of a.configFields) {
                      if (!(merged[f.key] ?? "").trim() && f.defaultValue) merged[f.key] = f.defaultValue;
                    }
                    return merged;
                  });
                }}
              >
                {adaptersForCap.map((a) => (
                  <option key={a.type} value={a.type}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {adapter?.configFields
          .filter((f) => !(adapterType === "comfyui" && (f.key === "model" || f.key === "workflow")))
          .map((f) => (
            <div key={f.key}>
              <label className="mb-1.5 block text-xs text-fg-dim">
                {f.label}
                {f.required && <span className="text-red-400"> *</span>}
              </label>
              {fieldControl(f, config[f.key] ?? "", (v) => setConfig((m) => ({ ...m, [f.key]: v })))}
              {ep && (f.key === "apiKey" || f.key === "secretKey" || f.type === "password") && (
                <p className="mt-1 text-[10px] text-fg-faint">已保存过。留空继续用原来的，不要把打码贴回去。</p>
              )}
            </div>
          ))}

        {(adapterType === "openai-compatible" || adapterType === "comfyui") && (
          <ProbeModels
            adapterType={adapterType}
            config={config}
            onPick={(id) => {
              setConfig((m) => ({ ...m, model: id }));
              if (id && !name.trim()) {
                const short = id.split(/[/\\]/).pop() ?? id;
                setName(short.replace(/\.(safetensors|ckpt|pt|pth|bin|gguf)$/i, "") || short);
              }
            }}
          />
        )}

        {adapterType === "comfyui" && (
          <div>
            <label className="mb-1.5 block text-xs text-fg-dim">
              工作流 JSON（API Format）
              {workflowRequired && <span className="text-red-400"> *</span>}
            </label>
            {fieldControl(
              {
                key: "workflow",
                type: "textarea",
                placeholder: "在 ComfyUI 菜单选 Save (API Format)，整段 JSON 贴到这里。可用 {{prompt}}。",
              },
              config.workflow ?? "",
              (v) => setConfig((m) => ({ ...m, workflow: v })),
            )}
            <ComfyWorkflowGuide
              model={config.model ?? ""}
              required={workflowRequired}
              filled={Boolean(config.workflow?.trim())}
            />
          </div>
        )}

        {capability === "llm" && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs text-fg-dim">
              <input type="checkbox" checked={webSearch} onChange={(e) => setWebSearch(e.target.checked)} className="accent-amber-400" />
              支持联网搜索（热点雷达依赖此能力）
            </label>
            <label className="flex items-center gap-2 text-xs text-fg-dim">
              <input type="checkbox" checked={vision} onChange={(e) => setVision(e.target.checked)} className="accent-amber-400" />
              能看图（竞品分析会把抽帧画面发给它）
            </label>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          {capability === "llm" && (
            <>
              <PriceField label="输入单价（元/千 tokens）" value={config.priceInput ?? ""} onChange={(v) => setConfig((m) => ({ ...m, priceInput: v }))} />
              <PriceField label="输出单价（元/千 tokens）" value={config.priceOutput ?? ""} onChange={(v) => setConfig((m) => ({ ...m, priceOutput: v }))} />
            </>
          )}
          {capability === "image" && (
            <PriceField label="单价（元/张）" value={config.priceImage ?? ""} onChange={(v) => setConfig((m) => ({ ...m, priceImage: v }))} />
          )}
          {capability === "tts" && (
            <>
              <PriceField label="单价（元/千字）" value={config.priceTts ?? ""} onChange={(v) => setConfig((m) => ({ ...m, priceTts: v }))} />
              <div>
                <label className="mb-1.5 block text-xs text-fg-dim">默认音色（时间线里还能改）</label>
                {voicesForConfig(config).length ? (
                  <select
                    className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-xs outline-none focus:border-accent-dim"
                    value={config.voice ?? ""}
                    onChange={(e) => setConfig((m) => ({ ...m, voice: e.target.value }))}
                  >
                    <option value="">时间线里再选</option>
                    {voicesForConfig(config).map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} · {v.tag} · {v.note}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 font-mono text-xs outline-none focus:border-accent-dim"
                    placeholder="音色 id"
                    value={config.voice ?? ""}
                    onChange={(e) => setConfig((m) => ({ ...m, voice: e.target.value }))}
                  />
                )}
              </div>
            </>
          )}
          {capability === "video" && (
            <PriceField label="单价（元/秒）" value={config.priceVideo ?? ""} onChange={(v) => setConfig((m) => ({ ...m, priceVideo: v }))} />
          )}
          <p className="col-span-2 text-[11px] text-fg-faint">
            {localish
              ? "本机模型没有渠道报价，花费记 0。要记账可以自己填单价。"
              : "保存时会向渠道要报价。百炼、OpenRouter 能拉到就直接写上，拉不到请手填。"}
          </p>
        </div>

        {error && (
          <div className={`text-xs ${error.includes("拉不到报价") ? "text-amber-500" : "text-red-400"}`}>{error}</div>
        )}

        <div className="flex justify-end gap-2">
          <button className="rounded-lg border border-line px-4 py-1.5 text-sm text-fg-dim hover:bg-panel-2" onClick={props.onClose}>
            取消
          </button>
          <button
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-black hover:brightness-110 disabled:opacity-40"
            disabled={!canSaveEndpoint || saveMutation.isPending}
            title={
              !name.trim()
                ? "先填名称"
                : workflowRequired && !config.workflow?.trim()
                  ? "先贴工作流再保存"
                  : undefined
            }
            onClick={() => {
              if (!name.trim()) {
                setError("先填名称再保存");
                return;
              }
              if (workflowRequired && !config.workflow?.trim()) {
                setError(customWorkflowHint(config.model ?? ""));
                return;
              }
              saveMutation.mutate();
            }}
          >
            {saveMutation.isPending ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function PriceField(props: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs text-fg-dim">{props.label}</label>
      <input
        type="number"
        min="0"
        step="0.0001"
        className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 font-mono text-xs outline-none focus:border-accent-dim"
        placeholder="能拉到会自动填"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </div>
  );
}
