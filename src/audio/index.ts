/**
 * Audio engine: one AudioContext created on the first user gesture (browsers block audio
 * before that), a master/music/sfx gain structure driven by the settings, synthesized SFX and
 * the music player. Suspends while the tab is hidden. Every call is safe before unlock.
 */
import { Music, type MusicMode } from "./music";
import { SFX, type SfxName } from "./sfx";

export interface AudioSettings {
  music: boolean;
  sfx: boolean;
  volume: number;
}

/** Minimum gap between two plays of the same effect, in seconds. */
const MIN_GAP: Partial<Record<SfxName, number>> = { lane: 0.04, hover: 0.06, bellota: 0.025, land: 0.06, nearMiss: 0.15 };

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private music: Music | null = null;
  private settings: AudioSettings;
  private mode: MusicMode = "off";
  private powerup = false;
  private lastPlayed = new Map<SfxName, number>();
  private bellotaStreak = 0;
  private lastBellota = -1;
  private readonly cleanups: (() => void)[] = [];

  constructor(settings: AudioSettings) {
    this.settings = { ...settings };
    const unlock = (): void => this.unlock();
    const opts = { capture: true, passive: true } as const;
    for (const type of ["pointerdown", "keydown", "touchstart"] as const) {
      window.addEventListener(type, unlock, opts);
      this.cleanups.push(() => window.removeEventListener(type, unlock, opts));
    }
    const onVisibility = (): void => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend().catch(() => undefined);
      else void this.ctx.resume().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVisibility);
    this.cleanups.push(() => document.removeEventListener("visibilitychange", onVisibility));
  }

  /** Create or resume the context. Called from user gestures. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended" && !document.hidden) void this.ctx.resume().catch(() => undefined);
      return;
    }
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      const ctx = new Ctor({ latencyHint: "interactive" });
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 12;
      comp.ratio.value = 3;
      comp.attack.value = 0.005;
      comp.release.value = 0.2;
      comp.connect(ctx.destination);
      this.master = ctx.createGain();
      this.master.connect(comp);
      this.musicGain = ctx.createGain();
      this.musicGain.connect(this.master);
      this.sfxGain = ctx.createGain();
      this.sfxGain.connect(this.master);
      this.ctx = ctx;
      this.music = new Music(ctx, this.musicGain);
      this.applySettings(this.settings);
      this.music.setMode(this.mode);
      this.music.setPowerup(this.powerup);
      void ctx.resume().catch(() => undefined);
    } catch {
      this.ctx = null;
    }
  }

  get unlocked(): boolean {
    return this.ctx !== null;
  }

  applySettings(settings: AudioSettings): void {
    this.settings = { ...settings };
    if (!this.ctx || !this.master || !this.musicGain || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const vol = Math.min(1, Math.max(0, settings.volume));
    // Perceptual curve so the slider feels even.
    this.master.gain.setTargetAtTime(vol * vol, now, 0.03);
    this.musicGain.gain.setTargetAtTime(settings.music ? 0.5 : 0, now, 0.05);
    this.sfxGain.gain.setTargetAtTime(settings.sfx ? 0.9 : 0, now, 0.03);
    this.music?.setEnabled(settings.music);
  }

  play(name: SfxName, arg = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxGain || !this.settings.sfx || ctx.state !== "running") return;
    const now = ctx.currentTime;
    const gap = MIN_GAP[name];
    const last = this.lastPlayed.get(name);
    if (gap !== undefined && last !== undefined && now - last < gap) return;
    this.lastPlayed.set(name, now);
    try {
      SFX[name](ctx, this.sfxGain, now + 0.005, arg);
    } catch {
      // A failed voice must never break the game.
    }
  }

  /** Bellota ping whose pitch climbs with quick consecutive pickups. */
  bellota(): void {
    const now = this.ctx?.currentTime ?? 0;
    this.bellotaStreak = now - this.lastBellota < 0.45 ? this.bellotaStreak + 1 : 0;
    this.lastBellota = now;
    this.play("bellota", this.bellotaStreak);
  }

  setMusicMode(mode: MusicMode): void {
    this.mode = mode;
    this.music?.setMode(mode);
  }

  setSpeed(speed: number): void {
    this.music?.setSpeed(speed);
  }

  setPowerup(on: boolean): void {
    this.powerup = on;
    this.music?.setPowerup(on);
  }

  /** Stop the music with the game-over sting. */
  sting(): void {
    this.mode = "off";
    if (this.music && this.musicGain && this.settings.music) this.music.sting(this.musicGain);
    else this.music?.setMode("off");
  }

  dispose(): void {
    for (const c of this.cleanups) c();
    this.music?.dispose();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}

export type { MusicMode } from "./music";
export type { SfxName } from "./sfx";
