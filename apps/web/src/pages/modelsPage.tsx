import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  capabilityLabels,
  type Capability,
  type FieldSpec,
  type ModelEndpoint,
  type TestResult,
} from "@vw/models";
import { api, apiJson } from "../lib/api";
import { iconPlus, iconTrash } from "../lib/icons";
import { Modal } from "../components/modal";

interface AdapterMeta {
  type: string;
  label: string;
  capabilities: Capability[];
  configFields: FieldSpec[];
}

const capabilities: Capability[] = ["llm", "image", "video", "tts"];

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
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});

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

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["model-endpoints"] });

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

  return (
    <div className="max-w-3xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">模型</h1>
          <p className="mt-0.5 text-xs text-fg-faint">
            自己配置文本 / 图片 / 视频 / 语音模型。编辑端点时填单价，下面就能看到花了多少钱。
          </p>
        </div>
        <button
          className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-black hover:brightness-110"
          onClick={() => setEditing("new")}
        >
          {iconPlus({})} 添加端点
        </button>
      </div>

      {usage && (
        <section className="mb-6 rounded-xl border border-line bg-panel p-4">
          <h2 className="text-xs font-medium text-fg-faint">近 30 天花费</h2>
          <div className="mt-2 flex flex-wrap gap-6">
            <div>
              <div className="text-2xl font-semibold tabular-nums">¥{usage.totalCost.toFixed(2)}</div>
              <div className="text-[11px] text-fg-faint">没填单价时显示 0，用量仍会记下</div>
            </div>
            <div className="text-xs text-fg-dim">
              <div>{usage.totalCalls} 次调用</div>
              <div>{usage.promptTokens + usage.completionTokens} tokens</div>
              <div>{usage.images} 张图 · {usage.audioChars} 字配音</div>
            </div>
          </div>
          {usage.byEndpoint.length > 0 && (
            <div className="mt-3 space-y-1">
              {usage.byEndpoint.map((row) => (
                <div key={row.endpointId || row.name} className="flex justify-between text-[11px] text-fg-dim">
                  <span>{row.name} · {capabilityLabels[row.capability]} · {row.calls} 次</span>
                  <span className="tabular-nums">¥{Number(row.cost).toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="space-y-6">
        {capabilities.map((cap) => {
          const list = grouped.get(cap) ?? [];
          return (
            <section key={cap}>
              <h2 className="mb-2 text-xs font-medium text-fg-faint">{capabilityLabels[cap]}</h2>
              {list.length === 0 ? (
                <div className="rounded-xl border border-dashed border-line px-4 py-3 text-xs text-fg-faint">
                  未配置
                </div>
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
                          <span className="text-[11px] text-fg-faint">{ep.config.model}</span>
                          <div className="ml-auto flex items-center gap-1">
                            <button
                              className="rounded-md border border-line px-2 py-1 text-[11px] text-fg-dim hover:text-accent disabled:opacity-40"
                              disabled={testMutation.isPending}
                              onClick={() => testMutation.mutate(ep.id)}
                            >
                              测试
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
                                if (confirm(`删除端点「${ep.name}」？`)) deleteMutation.mutate(ep.id);
                              }}
                            >
                              {iconTrash({ width: 12, height: 12 })}
                            </button>
                          </div>
                        </div>
                        <div className="mt-1.5 font-mono text-[11px] text-fg-faint">
                          {ep.config.baseUrl} · key {ep.config.apiKey ?? "未设置"}
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
            </section>
          );
        })}
      </div>

      {editing && adapters && (
        <EndpointModal
          adapters={adapters}
          endpoint={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            invalidate();
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 新建/编辑端点弹窗
// ---------------------------------------------------------------------------

function EndpointModal(props: {
  adapters: AdapterMeta[];
  endpoint: ModelEndpoint | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const ep = props.endpoint;
  const [name, setName] = useState(ep?.name ?? "");
  const [capability, setCapability] = useState<Capability>(ep?.capability ?? "llm");
  const [adapterType, setAdapterType] = useState(ep?.adapterType ?? props.adapters[0]?.type ?? "");
  const [config, setConfig] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of props.adapters.find((a) => a.type === (ep?.adapterType ?? props.adapters[0]?.type))?.configFields ?? []) {
      init[f.key] = ep?.config[f.key] ?? f.defaultValue ?? "";
    }
    for (const k of ["priceInput", "priceOutput", "priceImage", "priceTts", "priceVideo", "voice"] as const) {
      if (ep?.config[k]) init[k] = ep.config[k]!;
    }
    return init;
  });
  const [webSearch, setWebSearch] = useState(ep?.webSearch ?? false);
  const [vision, setVision] = useState(ep?.vision ?? false);
  const [error, setError] = useState("");

  const adapter = props.adapters.find((a) => a.type === adapterType);
  const allowedCaps = adapter?.capabilities ?? capabilities;

  const saveMutation = useMutation({
    mutationFn: async () => {
      // 编辑时 apiKey 留空 = 不修改
      const payload: Record<string, unknown> = { name: name.trim(), config, webSearch, vision };
      if (ep) {
        return apiJson<ModelEndpoint>(`/api/models/endpoints/${ep.id}`, "patch", payload);
      }
      return apiJson<ModelEndpoint>("/api/models/endpoints", "post", {
        ...payload,
        adapterType,
        capability,
      });
    },
    onSuccess: () => props.onSaved(),
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  return (
    <Modal title={ep ? `编辑端点 · ${ep.name}` : "添加模型端点"} onClose={props.onClose}>
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs text-fg-dim">名称</label>
          <input
            autoFocus
            className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent-dim"
            placeholder="例如：我的 DeepSeek"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
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
                {capabilities
                  .filter((c) => allowedCaps.includes(c))
                  .map((c) => (
                    <option key={c} value={c}>{capabilityLabels[c]}</option>
                  ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-fg-dim">适配器</label>
              <select
                className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm outline-none"
                value={adapterType}
                onChange={(e) => setAdapterType(e.target.value)}
              >
                {props.adapters.map((a) => (
                  <option key={a.type} value={a.type}>{a.label}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {adapter?.configFields.map((f) => (
          <div key={f.key}>
            <label className="mb-1.5 block text-xs text-fg-dim">
              {f.label}
              {f.required && <span className="text-red-400"> *</span>}
            </label>
            <input
              type={f.type === "password" ? "password" : "text"}
              className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 font-mono text-xs outline-none focus:border-accent-dim"
              placeholder={f.placeholder}
              value={config[f.key] ?? ""}
              onChange={(e) => setConfig((m) => ({ ...m, [f.key]: e.target.value }))}
            />
            {ep && f.key === "apiKey" && (
              <p className="mt-1 text-[10px] text-fg-faint">留空表示不修改现有密钥</p>
            )}
          </div>
        ))}

        {capability === "llm" && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs text-fg-dim">
              <input
                type="checkbox"
                checked={webSearch}
                onChange={(e) => setWebSearch(e.target.checked)}
                className="accent-amber-400"
              />
              支持联网搜索（热点雷达依赖此能力）
            </label>
            <label className="flex items-center gap-2 text-xs text-fg-dim">
              <input
                type="checkbox"
                checked={vision}
                onChange={(e) => setVision(e.target.checked)}
                className="accent-amber-400"
              />
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
                <label className="mb-1.5 block text-xs text-fg-dim">配音音色</label>
                <input
                  className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 font-mono text-xs outline-none focus:border-accent-dim"
                  placeholder="alloy / nova / onyx"
                  value={config.voice ?? ""}
                  onChange={(e) => setConfig((m) => ({ ...m, voice: e.target.value }))}
                />
              </div>
            </>
          )}
          {capability === "video" && (
            <PriceField label="单价（元/秒）" value={config.priceVideo ?? ""} onChange={(v) => setConfig((m) => ({ ...m, priceVideo: v }))} />
          )}
        </div>

        {error && <div className="text-xs text-red-400">{error}</div>}

        <div className="flex justify-end gap-2">
          <button
            className="rounded-lg border border-line px-4 py-1.5 text-sm text-fg-dim hover:bg-panel-2"
            onClick={props.onClose}
          >
            取消
          </button>
          <button
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-black hover:brightness-110 disabled:opacity-40"
            disabled={!name.trim() || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
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
        placeholder="选填"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </div>
  );
}