import { clampBpm } from "@/lib/settings";

const TICK_URL = "/tick.mp3";
const SCHEDULE_AHEAD = 0.15;
const SCHEDULE_EVERY_MS = 25;

type ScheduledTick = {
  source: AudioBufferSourceNode;
  time: number;
};

// Tick sample: "Metronome click" by Sadiquecat, CC0.
// https://freesound.org/people/Sadiquecat/sounds/793346/
export class Metronome {
  private context: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private encoded: ArrayBuffer | null = null;
  private loading: Promise<void> | null = null;
  private timer: number | null = null;
  private queue: ScheduledTick[] = [];
  private nextBeatTime = 0;
  private beatEpoch = 0;
  private bpm = 120;
  private playing = false;

  warmup() {
    if (this.encoded || this.loading) return;

    this.loading = fetch(TICK_URL)
      .then((response) => {
        if (!response.ok) throw new Error("Could not load the tick sound.");
        return response.arrayBuffer();
      })
      .then((encoded) => {
        this.encoded = encoded;
      })
      .catch(() => {
        // Playback retries the download if this warmup request fails.
      })
      .finally(() => {
        this.loading = null;
      });
  }

  get time() {
    return this.context?.currentTime ?? 0;
  }

  get isPlaying() {
    return this.playing;
  }

  angleAt(time: number) {
    if (!this.playing) return 0;
    const phase = (time - this.beatEpoch) / (60 / this.bpm);
    return Math.cos(phase * Math.PI) * 26;
  }

  beatAt(time: number) {
    if (!this.playing) return -1;
    const phase = (time - this.beatEpoch) / (60 / this.bpm);
    return Math.floor(phase + 0.0001);
  }

  async start(bpm: number) {
    await this.prepare();
    this.stop();
    this.bpm = clampBpm(bpm);

    const now = this.context!.currentTime;
    this.beatEpoch = now + 0.05;
    this.nextBeatTime = this.beatEpoch;
    this.playing = true;
    this.schedule();
  }

  stop() {
    this.playing = false;

    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }

    for (const tick of this.queue) {
      try {
        tick.source.stop();
      } catch {
        // The click may already have finished.
      }
    }

    this.queue = [];
  }

  setBpm(bpm: number) {
    const next = clampBpm(bpm);

    if (!this.playing || !this.context) {
      this.bpm = next;
      return;
    }

    const now = this.context.currentTime;
    const phase = (now - this.beatEpoch) / (60 / this.bpm);
    this.bpm = next;

    const interval = 60 / next;
    this.beatEpoch = now - phase * interval;

    let nextBeat = this.beatEpoch + Math.ceil(Math.max(phase, 0) - 0.000001) * interval;
    if (nextBeat < now + 0.02) nextBeat += interval;

    this.nextBeatTime = nextBeat;
    this.cancelUpcoming(now);
  }

  private async prepare() {
    if (!this.context) this.context = new AudioContext();
    if (this.context.state === "suspended") await this.context.resume();

    if (!this.encoded) {
      if (this.loading) await this.loading;
      if (!this.encoded) {
        const response = await fetch(TICK_URL);
        if (!response.ok) throw new Error("Could not load the tick sound.");
        this.encoded = await response.arrayBuffer();
      }
    }

    if (!this.buffer) {
      this.buffer = await this.context.decodeAudioData(this.encoded.slice(0));
    }
  }

  private schedule = () => {
    if (!this.playing || !this.context || !this.buffer) return;

    const horizon = this.context.currentTime + SCHEDULE_AHEAD;

    while (this.nextBeatTime < horizon) {
      this.playTick(this.nextBeatTime);
      this.nextBeatTime += 60 / this.bpm;
    }

    this.timer = window.setTimeout(this.schedule, SCHEDULE_EVERY_MS);
  };

  private playTick(time: number) {
    const context = this.context;
    const buffer = this.buffer;
    if (!context || !buffer) return;

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start(time);

    const tick = { source, time };
    this.queue.push(tick);
    source.onended = () => {
      this.queue = this.queue.filter((item) => item !== tick);
    };
  }

  private cancelUpcoming(now: number) {
    this.queue = this.queue.filter((tick) => {
      if (tick.time <= now + 0.005) return true;
      try {
        tick.source.stop();
      } catch {
        // Already started or stopped.
      }
      return false;
    });
  }
}
