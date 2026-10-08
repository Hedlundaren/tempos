export const STORAGE_KEY = "tempos";

export const MIN_BPM = 40;
export const MAX_BPM = 240;

export type Tempo = {
  id: string;
  name: string;
  bpm: number;
};

export type TempoSettings = {
  tempos: Tempo[];
  selectedId: string | null;
};

export function clampBpm(value: number): number {
  if (!Number.isFinite(value)) return 120;
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(value)));
}

function starterSettings(): TempoSettings {
  const tempos: Tempo[] = [
    { id: crypto.randomUUID(), name: "Slow", bpm: 72 },
    { id: crypto.randomUUID(), name: "Medium", bpm: 108 },
    { id: crypto.randomUUID(), name: "Fast", bpm: 144 },
  ];

  return { tempos, selectedId: tempos[1]?.id ?? null };
}

function sanitize(value: unknown): TempoSettings | null {
  if (!value || typeof value !== "object") return null;

  const record = value as { tempos?: unknown; selectedId?: unknown };
  if (!Array.isArray(record.tempos)) return null;

  const tempos: Tempo[] = [];

  for (const item of record.tempos) {
    if (!item || typeof item !== "object") continue;
    const tempo = item as Partial<Tempo>;
    if (typeof tempo.id !== "string" || typeof tempo.name !== "string") continue;
    if (typeof tempo.bpm !== "number") continue;

    tempos.push({
      id: tempo.id,
      name: tempo.name.slice(0, 60),
      bpm: clampBpm(tempo.bpm),
    });
  }

  const selectedId =
    typeof record.selectedId === "string" &&
    tempos.some((tempo) => tempo.id === record.selectedId)
      ? record.selectedId
      : (tempos[0]?.id ?? null);

  return { tempos, selectedId };
}

export function loadSettings(): TempoSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return starterSettings();

    const parsed: unknown = JSON.parse(raw);
    return sanitize(parsed) ?? starterSettings();
  } catch {
    return starterSettings();
  }
}

export function saveSettings(settings: TempoSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable in private browsing.
  }
}

let snapshot: TempoSettings | null = null;
let loaded = false;
const listeners = new Set<() => void>();

function ensureLoaded() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  snapshot = loadSettings();
}

export function subscribeSettings(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSettingsSnapshot() {
  ensureLoaded();
  return snapshot;
}

export function getServerSettingsSnapshot() {
  return null;
}

export function writeSettings(next: TempoSettings) {
  snapshot = next;
  loaded = true;
  saveSettings(next);
  for (const listener of listeners) listener();
}
