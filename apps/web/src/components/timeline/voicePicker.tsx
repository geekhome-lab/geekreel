import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { VOICE_TAGS, type TtsVoice, type VoiceFamily, type VoiceTag } from "@vw/models";
import { api, apiJson } from "../../lib/api";
import { usePrefs } from "../../lib/prefs";

type FamilyCard = {
  id: Exclude<VoiceFamily, "generic">;
  name: string;
  voices: TtsVoice[];
  endpointId: string | null;
  endpointName: string | null;
};

type VoicesPayload = {
  endpointId: string | null;
  endpointName: string | null;
  family: VoiceFamily;
  voices: TtsVoice[];
  families: FamilyCard[];
  endpoints: Array<{ id: string; name: string; family: string; familyName: string; voiceCount: number }>;
};

export function VoicePicker(props: {
  projectId: string;
  busy?: boolean;
  onDub: (voice: string, endpointId: string) => void;
}) {
  const prefs = usePrefs();
  const [family, setFamily] = useState<Exclude<VoiceFamily, "generic"> | "">(
    prefs.ttsFamily === "openai" || prefs.ttsFamily === "minimax" || prefs.ttsFamily === "doubao" || prefs.ttsFamily === "qwen"
      ? prefs.ttsFamily
      : "",
  );
  const [tag, setTag] = useState<VoiceTag | "">("");
  const [picked, setPicked] = useState(prefs.ttsVoice);
  const [previewing, setPreviewing] = useState("");
  const [error, setError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const { data } = useQuery({
    queryKey: ["tts-voices"],
    queryFn: () => api<VoicesPayload>("/api/models/voices"),
  });

  const current = useMemo(() => {
    const cards = data?.families ?? [];
    if (!cards.length) return null;
    return (
      cards.find((f) => f.id === family) ||
      cards.find((f) => f.id === data?.family) ||
      cards.find((f) => f.endpointId) ||
      cards[0]!
    );
  }, [data, family]);

  const voices = useMemo(() => {
    const all = current?.voices ?? [];
    return tag ? all.filter((v) => v.tag === tag) : all;
  }, [current, tag]);

  const preview = async (voice: TtsVoice) => {
    if (!current?.endpointId) {
      setError(`「${current?.name ?? "这个渠道"}」还没接到模型页，先去加一个语音端点。`);
      return;
    }
    setPreviewing(voice.id);
    setError("");
    try {
      const r = await apiJson<{ assetId: string }>("/api/gen/tts-preview", "post", {
        voice: voice.id,
        endpointId: current.endpointId,
        projectId: props.projectId,
      });
      audioRef.current?.pause();
      const audio = new Audio(`/api/assets/${r.assetId}/file`);
      audioRef.current = audio;
      await audio.play();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewing("");
    }
  };

  if (!data || !current) {
    return <p className="text-[11px] text-fg-faint">在拉各家音色…</p>;
  }

  const pickedName = voices.find((v) => v.id === picked)?.name ?? current.voices.find((v) => v.id === picked)?.name ?? picked;
  const canDub = Boolean(current.endpointId && picked && current.voices.some((v) => v.id === picked));

  return (
    <div className="mb-3 rounded-xl border border-line bg-panel p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-fg">选音色再配音</span>
        <span className="text-[11px] text-fg-faint">通义 / OpenAI / MiniMax / 豆包都在这儿</span>
      </div>
      <div className="mb-2 flex flex-wrap gap-1">
        {data.families.map((f) => (
          <button
            key={f.id}
            className={`rounded-full px-2.5 py-1 text-[11px] ${
              current.id === f.id ? "bg-accent text-black" : "bg-panel-2 text-fg-dim"
            }`}
            onClick={() => {
              setFamily(f.id);
              setTag("");
              prefs.patch({ ttsFamily: f.id, ttsEndpointId: f.endpointId ?? "" });
            }}
          >
            {f.name} · {f.voices.length}
            {f.endpointId ? "" : " · 未接入"}
          </button>
        ))}
      </div>
      <div className="mb-2 flex flex-wrap gap-1">
        <button
          className={`rounded-full px-2 py-0.5 text-[11px] ${tag === "" ? "bg-accent text-black" : "bg-panel-2 text-fg-dim"}`}
          onClick={() => setTag("")}
        >
          全部
        </button>
        {VOICE_TAGS.filter((t) => current.voices.some((v) => v.tag === t)).map((t) => (
          <button
            key={t}
            className={`rounded-full px-2 py-0.5 text-[11px] ${tag === t ? "bg-accent text-black" : "bg-panel-2 text-fg-dim"}`}
            onClick={() => setTag(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {!current.endpointId ? (
        <p className="mb-2 text-[11px] text-amber-200">
          {current.name} 的声音都列在下面了。到「模型」加一个{current.name}配音端点后就能试听、铺轨。
        </p>
      ) : (
        <p className="mb-2 text-[11px] text-fg-faint">走 {current.endpointName}</p>
      )}
      <div className="grid max-h-52 grid-cols-2 gap-1.5 overflow-auto md:grid-cols-3">
        {voices.map((v) => (
          <div
            key={v.id}
            className={`flex items-start justify-between gap-1 rounded-lg border px-2 py-1.5 ${
              picked === v.id ? "border-accent bg-accent/10" : "border-line"
            }`}
          >
            <button
              className="min-w-0 text-left"
              onClick={() => {
                setPicked(v.id);
                prefs.patch({ ttsVoice: v.id, ttsFamily: current.id, ttsEndpointId: current.endpointId ?? "" });
              }}
            >
              <div className="truncate text-[12px] text-fg">{v.name}</div>
              <div className="truncate text-[10px] text-fg-faint">
                {v.tag} · {v.note}
              </div>
            </button>
            <button
              className="shrink-0 text-[10px] text-accent underline disabled:opacity-40"
              disabled={previewing === v.id || !current.endpointId}
              onClick={() => void preview(v)}
            >
              {previewing === v.id ? "…" : "试听"}
            </button>
          </div>
        ))}
      </div>
      {error ? <p className="mt-2 text-[11px] text-red-300">{error}</p> : null}
      <div className="mt-2 flex items-center gap-2">
        <button
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-black disabled:opacity-40"
          disabled={props.busy || !canDub}
          onClick={() => {
            if (!picked || !current.endpointId) return;
            prefs.patch({ ttsVoice: picked, ttsFamily: current.id, ttsEndpointId: current.endpointId });
            props.onDub(picked, current.endpointId);
          }}
        >
          {props.busy ? "配音中…" : canDub ? `用「${pickedName}」配音` : current.endpointId ? "先点一个音色" : `先接入${current.name}`}
        </button>
        <span className="text-[11px] text-fg-faint">先试听，再配整条时间线。字幕已经可以先铺上。</span>
      </div>
    </div>
  );
}
