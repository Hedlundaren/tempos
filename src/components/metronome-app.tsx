"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Metronome } from "@/lib/metronome";
import {
  MAX_BPM,
  MIN_BPM,
  clampBpm,
  getServerSettingsSnapshot,
  getSettingsSnapshot,
  subscribeSettings,
  writeSettings,
  type Tempo,
} from "@/lib/settings";

export function MetronomeApp() {
  const settings = useSyncExternalStore(
    subscribeSettings,
    getSettingsSnapshot,
    getServerSettingsSnapshot,
  );
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [bpmDraft, setBpmDraft] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftBpm, setDraftBpm] = useState("120");
  const [error, setError] = useState<string | null>(null);

  const metronomeRef = useRef<Metronome | null>(null);
  const armRef = useRef<HTMLDivElement>(null);
  const bobRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);

  const selected =
    settings?.tempos.find((tempo) => tempo.id === settings.selectedId) ?? null;
  const displayedBpm = bpmDraft ?? (selected ? String(selected.bpm) : "");

  useEffect(() => {
    const metronome = new Metronome();
    metronomeRef.current = metronome;
    metronome.warmup();
    return () => metronome.stop();
  }, []);

  const play = useCallback(
    async (id: string) => {
      const tempo = settings?.tempos.find((item) => item.id === id);
      const metronome = metronomeRef.current;
      if (!settings || !metronome || !tempo || busyRef.current) return;

      if (playingId === id) {
        metronome.stop();
        setPlayingId(null);
        return;
      }

      writeSettings({ ...settings, selectedId: id });

      try {
        busyRef.current = true;
        if (playingId) metronome.setBpm(tempo.bpm);
        else await metronome.start(tempo.bpm);
        setPlayingId(id);
        setError(null);
      } catch {
        metronome.stop();
        setPlayingId(null);
        setError("The tick sound couldn’t be played.");
      } finally {
        busyRef.current = false;
      }
    },
    [playingId, settings],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, button, a, select, [contenteditable='true']")
      ) {
        return;
      }

      event.preventDefault();
      if (settings?.selectedId) void play(settings.selectedId);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [play, settings]);

  useEffect(() => {
    const arm = armRef.current;
    if (!arm) return;

    if (!playingId) {
      arm.style.transition = "transform 280ms ease-out";
      arm.style.transform = "rotate(0deg)";
      return;
    }

    arm.style.transition = "none";
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let lastBeat = -1;

    const loop = () => {
      const metronome = metronomeRef.current;
      if (!metronome) return;

      const now = metronome.time;
      if (!reduceMotion) {
        arm.style.transform = `rotate(${metronome.angleAt(now)}deg)`;
      }

      const beat = metronome.beatAt(now);
      if (beat !== lastBeat) {
        lastBeat = beat;
        const bob = bobRef.current;
        if (bob && beat >= 0) {
          bob.classList.remove("bob-flash");
          void bob.offsetWidth;
          bob.classList.add("bob-flash");
        }
      }

      frame = window.requestAnimationFrame(loop);
    };

    frame = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(frame);
  }, [playingId]);

  function updateTempo(id: string, patch: Partial<Pick<Tempo, "name" | "bpm">>) {
    if (!settings) return;

    writeSettings({
      ...settings,
      tempos: settings.tempos.map((tempo) =>
        tempo.id === id ? { ...tempo, ...patch } : tempo,
      ),
    });
  }

  function selectTempo(id: string) {
    const tempo = settings?.tempos.find((item) => item.id === id);
    if (!settings || !tempo || settings.selectedId === id) return;

    writeSettings({ ...settings, selectedId: id });
    setBpmDraft(null);

    if (playingId) {
      metronomeRef.current?.setBpm(tempo.bpm);
      setPlayingId(id);
    }
  }

  function changeBpm(bpm: number) {
    if (!selected) return;
    const next = clampBpm(bpm);
    setBpmDraft(null);
    if (next === selected.bpm) return;

    updateTempo(selected.id, { bpm: next });
    if (playingId === selected.id) metronomeRef.current?.setBpm(next);
  }

  function onBpmDraftChange(value: string) {
    if (/^\d{2,3}$/.test(value)) {
      const bpm = Number(value);
      if (bpm >= MIN_BPM && bpm <= MAX_BPM) {
        changeBpm(bpm);
        return;
      }
    }

    setBpmDraft(value);
  }

  function onBpmKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();

    const parsed = Number(bpmDraft);
    const base =
      bpmDraft !== null &&
      /^\d+$/.test(bpmDraft) &&
      parsed >= MIN_BPM &&
      parsed <= MAX_BPM
        ? parsed
        : (selected?.bpm ?? 120);
    const delta = event.key === "ArrowUp" ? 1 : -1;
    changeBpm(base + delta);
  }

  function addTempo(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) return;

    const tempo: Tempo = {
      id: crypto.randomUUID(),
      name: draftName.trim(),
      bpm: clampBpm(Number(draftBpm)),
    };

    writeSettings({
      tempos: [...settings.tempos, tempo],
      selectedId: tempo.id,
    });
    setDraftName("");
    setDraftBpm(String(tempo.bpm));
    setBpmDraft(null);

    if (playingId) {
      metronomeRef.current?.setBpm(tempo.bpm);
      setPlayingId(tempo.id);
    }
  }

  function removeTempo(id: string) {
    if (!settings) return;

    const tempos = settings.tempos.filter((tempo) => tempo.id !== id);
    const selectedId =
      settings.selectedId === id ? (tempos[0]?.id ?? null) : settings.selectedId;

    writeSettings({ tempos, selectedId });

    if (playingId !== id) return;

    const next = tempos.find((tempo) => tempo.id === selectedId);
    if (next) {
      metronomeRef.current?.setBpm(next.bpm);
      setPlayingId(next.id);
      return;
    }

    metronomeRef.current?.stop();
    setPlayingId(null);
  }

  const playing = Boolean(selected && playingId === selected.id);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-5 sm:py-8">
      <header>
        <h1 className="text-2xl font-medium tracking-tight">Tempos</h1>
      </header>

      <section className="mt-5 rounded-3xl border border-line bg-card px-5 py-5 shadow-[0_16px_40px_rgba(0,0,0,0.28)]">
        <div className="flex items-center gap-4">
          <div className="relative h-28 w-28 shrink-0">
            <svg
              viewBox="0 0 112 108"
              className="absolute inset-0 text-foreground/15"
              aria-hidden="true"
            >
              <path
                d="M12 96 A44 44 0 0 1 100 96"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              />
            </svg>
            <div className="absolute top-1.5 left-1/2 size-2 -translate-x-1/2 rounded-full bg-foreground/80" />
            <div className="absolute top-2 left-1/2">
              <div
                ref={armRef}
                className="relative h-24 w-7 -ml-3.5 will-change-transform"
                style={{ transformOrigin: "top center" }}
              >
                <div className="absolute top-0 left-1/2 h-full w-px -translate-x-1/2 bg-foreground/75" />
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2">
                  <div
                    ref={bobRef}
                    className="size-5 rounded-full bg-accent shadow-[0_6px_14px_rgba(232,146,58,0.28)]"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="min-w-0 flex-1 text-center">
            <label className="sr-only" htmlFor="bpm">
              Beats per minute
            </label>
            <input
              id="bpm"
              value={selected ? displayedBpm : ""}
              onChange={(event) => onBpmDraftChange(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              onBlur={() => {
                if (!selected || bpmDraft === null) return;
                const bpm = Number(bpmDraft);
                if (!Number.isFinite(bpm)) {
                  setBpmDraft(null);
                  return;
                }
                changeBpm(bpm);
              }}
              onKeyDown={onBpmKeyDown}
              inputMode="numeric"
              enterKeyHint="done"
              disabled={!selected}
              autoComplete="off"
              className="w-full bg-transparent text-center font-display text-[clamp(2.75rem,14vw,3.75rem)] leading-none tracking-tight tabular-nums outline-none disabled:opacity-40"
            />
            <p className="mt-2 text-[0.65rem] tracking-[0.18em] text-muted uppercase">BPM</p>
            {selected?.name ? (
              <p className="mt-2 truncate text-sm text-foreground/80">{selected.name}</p>
            ) : (
              <p className="mt-2 text-sm text-muted">Untitled</p>
            )}
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <span className="w-7 text-xs text-muted tabular-nums">{MIN_BPM}</span>
          <input
            type="range"
            min={MIN_BPM}
            max={MAX_BPM}
            step={1}
            value={selected?.bpm ?? 120}
            onChange={(event) => changeBpm(Number(event.target.value))}
            disabled={!selected}
            aria-label="Beats per minute"
            className="tempo-slider w-full"
            style={
              {
                "--fill": `${((selected?.bpm ?? 120) - MIN_BPM) / (MAX_BPM - MIN_BPM) * 100}%`,
              } as React.CSSProperties
            }
          />
          <span className="w-8 text-right text-xs text-muted tabular-nums">{MAX_BPM}</span>
        </div>

        <button
          type="button"
          onClick={() => {
            if (selected) void play(selected.id);
          }}
          disabled={!selected}
          className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-accent text-base font-medium text-[#1a120c] transition-colors hover:bg-[#f3a14d] active:bg-[#d98434] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {playing ? <StopIcon /> : <PlayIcon />}
          {playing ? "Stop" : "Play"}
        </button>
        {error ? (
          <p role="alert" className="mt-2 text-center text-sm text-[#ffb4a2]">
            {error}
          </p>
        ) : null}
      </section>

      <section className="mt-7">
        <h2 className="text-sm font-medium text-muted">Saved tempos</h2>
        {settings && settings.tempos.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Add a tempo to start listening.</p>
        ) : null}
        <ul className="mt-4 flex flex-col gap-3">
          {settings?.tempos.map((tempo) => {
            const isSelected = tempo.id === settings.selectedId;
            const isPlaying = tempo.id === playingId;

            return (
              <li
                key={tempo.id}
                className={`flex items-center gap-2 rounded-2xl border px-2 py-2 ${
                  isSelected ? "border-accent/70 bg-accent/10" : "border-line bg-card"
                }`}
              >
                <button
                  type="button"
                  onClick={() => void play(tempo.id)}
                  aria-label={
                    isPlaying
                      ? `Stop ${tempo.name || tempo.bpm}`
                      : `Play ${tempo.name || tempo.bpm}`
                  }
                  aria-pressed={isPlaying}
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-white/8 text-foreground hover:bg-white/12 active:bg-white/16"
                >
                  {isPlaying ? <StopIcon /> : <PlayIcon />}
                </button>
                <input
                  value={tempo.name}
                  onChange={(event) => updateTempo(tempo.id, { name: event.target.value })}
                  onFocus={() => selectTempo(tempo.id)}
                  onBlur={(event) =>
                    updateTempo(tempo.id, { name: event.target.value.trim() })
                  }
                  placeholder="Untitled"
                  aria-label={`Name for ${tempo.bpm} BPM`}
                  maxLength={60}
                  enterKeyHint="done"
                  autoCapitalize="words"
                  className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted/70"
                />
                <span className="w-11 shrink-0 text-right text-base text-muted tabular-nums">
                  {tempo.bpm}
                </span>
                <button
                  type="button"
                  onClick={() => removeTempo(tempo.id)}
                  aria-label={`Delete ${tempo.name || tempo.bpm}`}
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-white/8 hover:text-foreground active:bg-white/12"
                >
                  <CloseIcon />
                </button>
              </li>
            );
          })}
        </ul>

        <form onSubmit={addTempo} className="mt-4 flex flex-col gap-3">
          <input
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            placeholder="Name"
            aria-label="New tempo name"
            maxLength={60}
            enterKeyHint="next"
            autoCapitalize="words"
            className="h-12 w-full rounded-xl border border-line bg-card px-3 text-base outline-none placeholder:text-muted/70 focus-visible:border-accent"
          />
          <div className="flex gap-3">
            <input
              value={draftBpm}
              onChange={(event) => setDraftBpm(event.target.value)}
              type="number"
              inputMode="numeric"
              min={MIN_BPM}
              max={MAX_BPM}
              required
              enterKeyHint="done"
              aria-label="New tempo BPM"
              className="h-12 w-24 rounded-xl border border-line bg-card px-3 text-base outline-none focus-visible:border-accent"
            />
            <button
              type="submit"
              className="h-12 flex-1 rounded-xl bg-foreground text-base font-medium text-background active:opacity-80"
            >
              Add tempo
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-5" aria-hidden="true">
      <path d="M6.5 4.8v10.4L15 10 6.5 4.8Z" fill="currentColor" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-5" aria-hidden="true">
      <rect x="5.5" y="5.5" width="9" height="9" rx="1.5" fill="currentColor" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-4" aria-hidden="true">
      <path
        d="M6 6l8 8M14 6l-8 8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
