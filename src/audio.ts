import { type MusicNote } from "./music";
import { MusicPlaylist } from "./playlist";
import { scheduleMovement, scheduleVoice } from "./synth";

export interface AudioPreferences {
    music: number;
    effects: number;
    muted: boolean;
}
type Effect = "select" | "move" | "spawn" | "blocked" | "clear" | "end";

/** One lazily-created audio graph. Scheduling uses the audio clock, not timer
 * intervals as a musical clock. Every source disconnects when it finishes. */
export class Soundscape {
    private context: AudioContext | null = null;
    private musicBus: GainNode | null = null;
    private effectsBus: GainNode | null = null;
    private master: GainNode | null = null;
    private reverb: ConvolverNode | null = null;
    private playlist: MusicPlaylist | null = null;
    private effectsRoom: GainNode | null = null;
    private idleTimer: ReturnType<typeof setTimeout> | undefined;
    private unlocked = false;
    private sources = new Map<OscillatorNode, "music" | "effects">();
    private preferences: AudioPreferences = { music: 0.1, effects: 0.5, muted: false };

    setPreferences(preferences: AudioPreferences) {
        this.preferences = preferences;
        this.applyVolumes();
        // Preference changes can originate from saved settings before a gesture.
        if (this.unlocked) void this.syncPlayback();
    }

    async unlock() {
        this.unlocked = true;
        await this.syncPlayback();
    }

    handleVisibility() {
        if (this.unlocked) void this.syncPlayback();
    }

    private get audible() {
        return (
            !document.hidden && !this.preferences.muted && (this.preferences.music > 0 || this.preferences.effects > 0)
        );
    }

    private async syncPlayback() {
        try {
            if (!this.audible) {
                this.stopScheduler();
                this.stopSources();
                if (this.context?.state === "running") await this.context.suspend();
                return;
            }
            const ctx = this.ensureContext();
            // iOS also reports "interrupted" after device/OS interruptions.
            // Resume synchronously in the gesture, not just from "suspended".
            const resuming = ctx.state !== "running" && ctx.state !== "closed" ? ctx.resume() : null;
            // Authorize both media elements before the first await (Safari).
            if (this.preferences.music > 0) this.startScheduler();
            else {
                this.stopScheduler();
                this.stopSources("music");
                this.suspendAfterEffects();
            }
            if (resuming) await resuming;
            // A mute/visibility event can arrive while resume() is pending.
            if (!this.audible) {
                this.stopScheduler();
                this.stopSources();
                await ctx.suspend();
            }
        } catch (error) {
            this.stopScheduler();
            // Audio is optional; denied device access must never stop a turn.
            console.warn("Atomicon audio is unavailable:", error);
        }
    }

    private ensureContext(): AudioContext {
        if (this.context) return this.context;
        const ctx = new AudioContext();
        this.context = ctx;
        this.master = ctx.createGain();
        this.master.gain.value = 0.8;
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -12;
        limiter.knee.value = 12;
        limiter.ratio.value = 5;
        limiter.attack.value = 0.008;
        limiter.release.value = 0.25;
        this.master.connect(limiter).connect(ctx.destination);
        this.musicBus = ctx.createGain();
        this.effectsBus = ctx.createGain();
        this.musicBus.connect(this.master);
        this.effectsBus.connect(this.master);
        this.reverb = ctx.createConvolver();
        const impulse = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.2), ctx.sampleRate);
        // Fixed noise seed keeps the room the same on every visit.
        let seed = 42;
        for (let channel = 0; channel < impulse.numberOfChannels; channel++) {
            const data = impulse.getChannelData(channel);
            for (let i = 0; i < data.length; i++) {
                seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
                data[i] =
                    (seed / 2147483648 - 1) *
                    Math.exp((-i / ctx.sampleRate) * 2.9) *
                    Math.min(1, i / (ctx.sampleRate * 0.025));
            }
        }
        this.reverb.buffer = impulse;
        const roomFilter = ctx.createBiquadFilter();
        roomFilter.type = "lowpass";
        roomFilter.frequency.value = 4200;
        this.reverb.connect(roomFilter).connect(this.master);
        // Sends are downstream of volume controls: zero means genuinely silent.
        this.effectsRoom = ctx.createGain();
        this.effectsRoom.gain.value = 0.2;
        this.effectsBus.connect(this.effectsRoom).connect(this.reverb);
        this.applyVolumes();
        return ctx;
    }

    private applyVolumes() {
        if (!this.context) return;
        const now = this.context.currentTime;
        this.musicBus?.gain.setTargetAtTime(this.preferences.music, now, 0.06);
        this.effectsBus?.gain.setTargetAtTime(this.preferences.effects, now, 0.025);
        this.master?.gain.setTargetAtTime(this.preferences.muted ? 0 : 0.8, now, 0.025);
    }

    private startScheduler() {
        if (!this.context || !this.musicBus) return;
        clearTimeout(this.idleTimer);
        this.playlist ??= new MusicPlaylist(this.context, this.musicBus);
        this.playlist.start();
    }

    private stopScheduler() {
        clearTimeout(this.idleTimer);
        this.playlist?.pause();
    }

    private stopSources(bus?: "music" | "effects") {
        for (const [source, kind] of this.sources) {
            if (!bus || kind === bus) {
                source.stop();
                this.sources.delete(source);
            }
        }
    }

    private playNote(note: MusicNote, at: number, bus: "music" | "effects") {
        const ctx = this.context;
        const destination = bus === "music" ? this.musicBus : this.effectsBus;
        if (!ctx || !destination) return;
        for (const osc of scheduleVoice(ctx, destination, note, at)) {
            this.sources.set(osc, bus);
            osc.addEventListener("ended", () => this.sources.delete(osc), { once: true });
        }
    }

    private suspendAfterEffects() {
        clearTimeout(this.idleTimer);
        if (this.preferences.music > 0) return;
        this.idleTimer = setTimeout(() => {
            if (this.preferences.music === 0 && this.context?.state === "running")
                void this.context.suspend().catch(() => {
                    /* Optional audio device. */
                });
        }, 7000);
    }

    effect(kind: Effect, strength = 1) {
        if (!this.context || this.context.state !== "running" || !this.audible || this.preferences.effects === 0)
            return;
        this.suspendAfterEffects();
        if (kind === "move") {
            if (!this.effectsBus) return;
            for (const osc of scheduleMovement(this.context, this.effectsBus, this.context.currentTime + 0.008)) {
                this.sources.set(osc, "effects");
                osc.addEventListener("ended", () => this.sources.delete(osc), { once: true });
            }
            return;
        }
        const at = this.context.currentTime + 0.005;
        const melodies: Record<Exclude<Effect, "move">, number[]> = {
            select: [81],
            spawn: [74, 78],
            blocked: [47, 45],
            clear: strength >= 2 ? [74, 78, 81, 85, 90] : [74, 78, 81, 86],
            end: [78, 74, 69, 62],
        };
        melodies[kind].forEach((midi, i) =>
            this.playNote(
                {
                    midi,
                    voice: kind === "blocked" ? "bass" : "key",
                    duration: kind === "end" ? 2.5 : kind === "clear" ? 1.7 : 0.35,
                    velocity: kind === "spawn" ? 0.055 : kind === "clear" ? 0.15 : 0.11,
                    pan: (i - 1) * 0.13,
                },
                at + i * (kind === "end" ? 0.22 : 0.07),
                "effects",
            ),
        );
    }
}
