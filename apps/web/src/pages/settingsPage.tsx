import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PublicSettings } from "@vw/core";
import { api, apiJson } from "../lib/api";
import { iconFolder } from "../lib/icons";
import { useT } from "../lib/i18n";
import { usePrefs, type FontScale, type LocaleId, type ThemeId } from "../lib/prefs";
import { BrandMark } from "../components/brand";
import { DirPicker } from "../components/dirPicker";

export function SettingsPage() {
  const t = useT();
  const prefs = usePrefs();
  const queryClient = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [notifyHint, setNotifyHint] = useState("");

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<PublicSettings>("/api/settings"),
  });

  const saveMutation = useMutation({
    mutationFn: (libraryRoot: string) =>
      apiJson<PublicSettings & { migrateJobId?: string; message?: string }>("/api/settings", "put", { libraryRoot }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      setMessage(data.migrateJobId ? t.settings.migrating : t.settings.saved);
      setError("");
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : String(e));
      setMessage("");
    },
  });

  async function toggleNotify(on: boolean) {
    if (!on) {
      prefs.patch({ notifyOnJobDone: false });
      setNotifyHint("");
      return;
    }
    if (!("Notification" in window)) {
      prefs.patch({ notifyOnJobDone: false });
      setNotifyHint(t.settings.notifyDenied);
      return;
    }
    const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (perm !== "granted") {
      prefs.patch({ notifyOnJobDone: false });
      setNotifyHint(t.settings.notifyDenied);
      return;
    }
    prefs.patch({ notifyOnJobDone: true });
    setNotifyHint("");
  }

  const themes: { id: ThemeId; label: string; hint: string; swatch: string[] }[] = [
    { id: "dark", label: t.settings.themeDark, hint: t.settings.themeDarkHint, swatch: ["#0c0d12", "#14161d", "#f5b53f"] },
    { id: "light", label: t.settings.themeLight, hint: t.settings.themeLightHint, swatch: ["#f3f1eb", "#fffcf6", "#c47d0e"] },
    { id: "eye", label: t.settings.themeEye, hint: t.settings.themeEyeHint, swatch: ["#e6dcc4", "#efe4c8", "#8b6914"] },
  ];

  return (
    <div className="max-w-2xl p-6">
      <div className="mb-6">
        <h1 className="text-lg font-semibold">{t.settings.title}</h1>
        <p className="mt-0.5 text-xs text-fg-faint">{t.settings.lead}</p>
      </div>

      <div className="space-y-4">
        <section className="rounded-xl border border-line bg-panel p-5">
          <h2 className="mb-1 text-sm font-medium">{t.settings.appearance}</h2>
          <p className="mb-4 text-xs text-fg-faint">{t.settings.appearanceHint}</p>

          <p className="mb-2 text-xs text-fg-dim">{t.settings.theme}</p>
          <div className="mb-5 grid grid-cols-3 gap-2">
            {themes.map((th) => (
              <button
                key={th.id}
                type="button"
                onClick={() => prefs.patch({ theme: th.id })}
                className={`rounded-xl border px-3 py-3 text-left ${
                  prefs.theme === th.id ? "border-accent bg-panel-2" : "border-line hover:bg-panel-2"
                }`}
              >
                <div className="mb-2 flex gap-1">
                  {th.swatch.map((c) => (
                    <span key={c} className="h-4 w-4 rounded-full border border-line" style={{ background: c }} />
                  ))}
                </div>
                <div className="text-sm">{th.label}</div>
                <div className="mt-0.5 text-[10px] text-fg-faint">{th.hint}</div>
              </button>
            ))}
          </div>

          <p className="mb-2 text-xs text-fg-dim">{t.settings.language}</p>
          <p className="mb-2 text-[10px] text-fg-faint">{t.settings.languageHint}</p>
          <div className="mb-5 flex gap-2">
            {(["zh", "en"] as LocaleId[]).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => prefs.patch({ locale: id })}
                className={`rounded-lg border px-4 py-2 text-sm ${
                  prefs.locale === id ? "border-accent bg-panel-2 text-accent" : "border-line text-fg-dim hover:bg-panel-2 hover:text-fg"
                }`}
              >
                {id === "zh" ? t.settings.zh : t.settings.en}
              </button>
            ))}
          </div>

          <p className="mb-2 text-xs text-fg-dim">{t.settings.font}</p>
          <div className="mb-5 flex gap-2">
            {([
              ["sm", t.settings.fontSm],
              ["md", t.settings.fontMd],
              ["lg", t.settings.fontLg],
            ] as [FontScale, string][]).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => prefs.patch({ fontScale: id })}
                className={`rounded-lg border px-4 py-2 text-sm ${
                  prefs.fontScale === id ? "border-accent bg-panel-2 text-accent" : "border-line text-fg-dim hover:bg-panel-2 hover:text-fg"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <ToggleRow label={t.settings.compactNav} on={prefs.compactNav} onChange={(on) => prefs.patch({ compactNav: on })} />
          <ToggleRow label={t.settings.reduceMotion} on={prefs.reduceMotion} onChange={(on) => prefs.patch({ reduceMotion: on })} />

          <button
            type="button"
            className="mt-3 text-xs text-fg-faint underline hover:text-fg-dim"
            onClick={() => prefs.reset()}
            title={t.settings.resetHint}
          >
            {t.settings.reset}
          </button>
        </section>

        <section className="rounded-xl border border-line bg-panel p-5">
          <h2 className="mb-3 text-sm font-medium">{t.settings.behavior}</h2>
          <ToggleRow label={t.settings.confirmDelete} on={prefs.confirmDelete} onChange={(on) => prefs.patch({ confirmDelete: on })} />
          <ToggleRow label={t.settings.autoplayPreview} on={prefs.autoplayPreview} onChange={(on) => prefs.patch({ autoplayPreview: on })} />
          <ToggleRow label={t.settings.notifyJobs} on={prefs.notifyOnJobDone} onChange={(on) => void toggleNotify(on)} />
          <ToggleRow label={t.settings.autoSubtitles} on={prefs.autoSubtitles} onChange={(on) => prefs.patch({ autoSubtitles: on })} />
          {notifyHint && <p className="mt-2 text-xs text-amber-500">{notifyHint}</p>}
        </section>

        <section className="rounded-xl border border-line bg-panel p-5">
          <h2 className="mb-1 text-sm font-medium">{t.settings.library}</h2>
          <p className="mb-3 text-xs text-fg-faint">{t.settings.libraryHint}</p>
          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center gap-2 rounded-lg border border-line bg-panel-2 px-3 py-2">
              <span className="text-accent">{iconFolder({})}</span>
              <span className="truncate font-mono text-xs">{settings?.libraryRoot ?? "…"}</span>
            </div>
            <button
              className="rounded-lg border border-line px-4 py-2 text-sm text-fg-dim hover:bg-panel-2 hover:text-fg"
              onClick={() => setPicking(true)}
            >
              {t.settings.change}
            </button>
            <button
              className="rounded-lg border border-line px-4 py-2 text-sm text-fg-dim hover:bg-panel-2 hover:text-fg"
              onClick={() => void apiJson("/api/settings/reveal", "post")}
            >
              {t.settings.openFolder}
            </button>
          </div>
          {message && <p className="mt-2 text-xs text-amber-500">{message}</p>}
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        </section>

        <section className="rounded-xl border border-line bg-panel p-5">
          <h2 className="mb-1 text-sm font-medium">{t.settings.media}</h2>
          <p className="mb-3 text-xs text-fg-faint">{t.settings.mediaHint}</p>
          {settings?.ffmpeg.available ? (
            <div className="space-y-1 text-xs">
              <div className="flex justify-between rounded bg-panel-2 px-3 py-1.5">
                <span className="text-fg-faint">ffmpeg</span>
                <span className="font-mono text-fg-dim">{settings.ffmpeg.ffmpeg}</span>
              </div>
              <div className="flex justify-between rounded bg-panel-2 px-3 py-1.5">
                <span className="text-fg-faint">ffprobe</span>
                <span className="font-mono text-fg-dim">{settings.ffmpeg.ffprobe ?? "—"}</span>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-700/40 bg-amber-950/20 p-3 text-xs text-amber-600">
              <p className="mb-1 font-medium">{t.settings.missingFfmpeg}</p>
              <p className="opacity-80">{t.settings.missingFfmpegHint}</p>
              <code className="mt-2 block rounded bg-black/20 px-2 py-1.5 font-mono text-[11px]">
                brew install ffmpeg
              </code>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-line bg-panel p-5">
          <h2 className="mb-3 text-sm font-medium">{t.settings.about}</h2>
          <div className="mb-4">
            <BrandMark size="md" />
          </div>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between rounded bg-panel-2 px-3 py-1.5">
              <span className="text-fg-faint">{t.settings.version}</span>
              <span className="font-mono text-fg-dim">v{settings?.version}</span>
            </div>
            <div className="flex justify-between rounded bg-panel-2 px-3 py-1.5">
              <span className="text-fg-faint">{t.settings.dataDir}</span>
              <span className="font-mono text-fg-dim">{settings?.dataDir}</span>
            </div>
            <div className="flex justify-between rounded bg-panel-2 px-3 py-1.5">
              <span className="text-fg-faint">{t.settings.assetCount}</span>
              <span className="font-mono text-fg-dim">{settings?.assetCount}</span>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-fg-faint">{t.settings.localNote}</p>
        </section>
      </div>

      {picking && settings && (
        <DirPicker
          title={t.settings.pickDir}
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

function ToggleRow(props: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.on}
      onClick={() => props.onChange(!props.on)}
      className="mb-2 flex w-full cursor-pointer items-center justify-between gap-4 rounded-lg px-1 py-1.5 text-left text-sm"
    >
      <span>{props.label}</span>
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${props.on ? "bg-accent" : "bg-line"}`}>
        <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-ink transition-transform ${props.on ? "translate-x-4" : ""}`} />
      </span>
    </button>
  );
}
