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
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col px-5 py-8 sm:py-12">
      <header>
        <h1 className="text-3xl font-medium tracking-tight">Tempos</h1>
        <p className="mt-2 max-w-sm text-sm leading-6 text-muted">
          Keep a list of tempos and play any of them. Only the BPM changes.
        </p>
      </header>

      <section className="mt-8 rounded-[28px] border border-line bg-card px-6 pt-8 pb-6 shadow-[0_24px_70px_rgba(0,0,0,0.28)]">
        <div className="relative mx-auto h-44 w-full max-w-xs">
          <svg
            viewBox="0 0 200 120"
            className="absolute inset-x-0 top-2 h-28 w-full text-foreground/15"
            aria-hidden="true"
          >
            <path
              d="M28 108 A72 72 0 0 1 172 108"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
          <div className="absolute top-3 left-1/2 size-2.5 -translate-x-1/2 rounded-full bg-foreground/80" />
          <div className="absolute top-4 left-1/2">
            <div
              ref={armRef}
              className="relative h-36 w-8 -ml-4 will-change-transform"
              style={{ transformOrigin: "top center" }}
            >
              <div className="absolute top-0 left-1/2 h-full w-px -translate-x-1/2 bg-foreground/75" />
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2">
                <div
                  ref={bobRef}
                  className="size-6 rounded-full bg-accent shadow-[0_8px_18px_rgba(232,146,58,0.28)]"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-2 text-center">
          <label className="sr-only" htmlFor="bpm">
            Beats per minute
          </label>
          <input
            id="bpm"
            value={selected ? displayedBpm : ""}
            onChange={(event) => onBpmDraftChange(event.target.value)}
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
            disabled={!selected}
            autoComplete="off"
            className="w-40 bg-transparent text-center font-display text-7xl leading-none tracking-tight tabular-nums outline-none disabled:opacity-40"
          />
          <p className="mt-2 text-xs tracking-[0.18em] text-muted uppercase">BPM</p>
          {selected?.name ? (
            <p className="mt-3 truncate text-sm text-foreground/80">{selected.name}</p>
          ) : null}
        </div>

        <div className="mt-6 flex items-center gap-3">
          <span className="w-8 text-xs text-muted tabular-nums">{MIN_BPM}</span>
          <input
            type="range"
            min={MIN_BPM}
            max={MAX_BPM}
            step={1}
            value={selected?.bpm ?? 120}
            onChange={(event) => changeBpm(Number(event.target.value))}
            disabled={!selected}
            aria-label="Beats per minute"
            className="h-2 w-full cursor-pointer accent-accent disabled:cursor-not-allowed disabled:opacity-40"
          />
          <span className="w-8 text-right text-xs text-muted tabular-nums">{MAX_BPM}</span>
        </div>

        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => {
              if (selected) void play(selected.id);
            }}
            disabled={!selected}
            className="inline-flex h-12 min-w-32 items-center justify-center gap-2 rounded-full bg-accent px-6 text-sm font-medium text-[#1a120c] transition-colors hover:bg-[#f3a14d] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {playing ? <StopIcon /> : <PlayIcon />}
            {playing ? "Stop" : "Play"}
          </button>
        </div>
        <p className="mt-3 text-center text-xs text-muted">Space to play or stop</p>
        {error ? (
          <p role="alert" className="mt-3 text-center text-sm text-[#ffb4a2]">
            {error}
          </p>
        ) : null}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-muted">Saved tempos</h2>
        {settings && settings.tempos.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Add a tempo to start listening.</p>
        ) : null}
        <ul className="mt-3 flex flex-col gap-2">
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
                  className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-white/8 text-foreground hover:bg-white/12"
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
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/70"
                />
                <span className="w-12 shrink-0 text-right text-sm text-muted tabular-nums">
                  {tempo.bpm}
                </span>
                <button
                  type="button"
                  onClick={() => removeTempo(tempo.id)}
                  aria-label={`Delete ${tempo.name || tempo.bpm}`}
                  className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-white/8 hover:text-foreground"
                >
                  <CloseIcon />
                </button>
              </li>
            );
          })}
        </ul>

        <form
          onSubmit={addTempo}
          className="mt-3 grid grid-cols-[minmax(0,1fr)_5.5rem_auto] gap-2"
        >
          <input
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            placeholder="Name"
            aria-label="New tempo name"
            maxLength={60}
            className="h-11 min-w-0 rounded-xl border border-line bg-card px-3 text-sm outline-none placeholder:text-muted/70 focus-visible:border-accent"
          />
          <input
            value={draftBpm}
            onChange={(event) => setDraftBpm(event.target.value)}
            type="number"
            min={MIN_BPM}
            max={MAX_BPM}
            required
            aria-label="New tempo BPM"
            className="h-11 rounded-xl border border-line bg-card px-3 text-sm outline-none focus-visible:border-accent"
          />
          <button
            type="submit"
            className="h-11 rounded-xl border border-line px-4 text-sm font-medium hover:border-accent hover:text-accent"
          >
            Add
          </button>
        </form>
      </section>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-4" aria-hidden="true">
      <path d="M6.5 4.8v10.4L15 10 6.5 4.8Z" fill="currentColor" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-4" aria-hidden="true">
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
