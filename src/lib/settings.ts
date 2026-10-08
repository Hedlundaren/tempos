export const MIN_BPM = 40;
export const MAX_BPM = 240;

const LEGACY_STORAGE_KEY = "tempos";
const TEMPOS_PARAM = "t";
const SELECTED_PARAM = "s";

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

function tempoParam(tempos: Tempo[]): string {
  return tempos
    .map((tempo) => `${encodeURIComponent(tempo.name)}:${tempo.bpm}`)
    .join(",");
}

function selectedParam(settings: TempoSettings): string | null {
  const index = settings.tempos.findIndex((tempo) => tempo.id === settings.selectedId);
  return index >= 0 ? String(index) : null;
}

function settingsFromSearch(search: string): TempoSettings | null {
  const params = new URLSearchParams(search);
  if (!params.has(TEMPOS_PARAM)) return null;

  const raw = params.get(TEMPOS_PARAM) ?? "";
  const tempos: Tempo[] = [];

  if (raw.length > 0) {
    for (const part of raw.split(",")) {
      const splitAt = part.lastIndexOf(":");
      if (splitAt < 0) continue;

      const bpm = Number(part.slice(splitAt + 1));
      if (!Number.isFinite(bpm)) continue;

      let name = part.slice(0, splitAt);
      try {
        name = decodeURIComponent(name);
      } catch {
        continue;
      }

      tempos.push({
        id: crypto.randomUUID(),
        name: name.slice(0, 60),
        bpm: clampBpm(bpm),
      });
    }
  }

  const selectedIndex = Number(params.get(SELECTED_PARAM));
  const selectedId =
    Number.isInteger(selectedIndex) && tempos[selectedIndex]
      ? tempos[selectedIndex].id
      : (tempos[0]?.id ?? null);

  return { tempos, selectedId };
}

function legacySettings(): TempoSettings | null {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const record = parsed as { tempos?: unknown; selectedId?: unknown };
    if (!Array.isArray(record.tempos)) return null;

    const tempos: Tempo[] = [];
    for (const item of record.tempos) {
      if (!item || typeof item !== "object") continue;
      const tempo = item as Partial<Tempo>;
      if (typeof tempo.name !== "string" || typeof tempo.bpm !== "number") continue;
      tempos.push({
        id: typeof tempo.id === "string" ? tempo.id : crypto.randomUUID(),
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
  } catch {
    return null;
  }
}

function clearLegacyStorage() {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
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
  snapshot = settingsFromSearch(window.location.search) ?? legacySettings() ?? starterSettings();
}

function notify() {
  for (const listener of listeners) listener();
}

export function publishSettingsUrl() {
  if (typeof window === "undefined") return;
  ensureLoaded();
  if (!snapshot) return;

  const params = new URLSearchParams(window.location.search);
  const tempos = tempoParam(snapshot.tempos);
  const selected = selectedParam(snapshot);
  if (params.get(TEMPOS_PARAM) === tempos && params.get(SELECTED_PARAM) === selected) {
    clearLegacyStorage();
    return;
  }

  const next = new URLSearchParams();
  next.set(TEMPOS_PARAM, tempos);
  if (selected !== null) next.set(SELECTED_PARAM, selected);

  const query = next.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  window.history.replaceState(window.history.state, "", url);
  clearLegacyStorage();
}

export function replaceSettings(next: TempoSettings) {
  snapshot = next;
  loaded = true;
  notify();
}

export function readSettingsFromLocation(): TempoSettings {
  if (typeof window === "undefined") return starterSettings();
  return settingsFromSearch(window.location.search) ?? starterSettings();
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
  publishSettingsUrl();
  notify();
}
