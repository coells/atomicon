import {
    checkLines,
    countOccupied,
    createEmptyGrid,
    findPath,
    generateNextColors,
    getSpawnCount,
    hasAnyMove,
    isBoardFull,
    PREVIEW_SIZE,
    removeMatches,
    spawnCells,
    VALID_CELL_COUNT,
    type CellColor,
    type Grid,
    type Position,
} from "./game";
import { Renderer } from "./renderer";

// ─── Sound FX + Generative Ambient Music ─────────────────────────────────────

/** Options for a single synthesized SFX tone. */
interface ToneOpts {
    dur: number;
    vol: number;
    type: OscillatorType;
    at?: number; // start offset in seconds
    attack?: number;
    hold?: number; // sustain at full volume until this offset
    freqEnd?: number; // exponential frequency sweep target
    sweep?: number; // sweep duration (defaults to dur)
    detune?: number;
}

class SFX {
    private actx: AudioContext | null = null;
    private sfxEnabled = true;
    private musicEnabled = true;

    /* ── ambient music engine state ── */
    private musicRunning = false;
    private musicTimer: number | null = null;
    private melodyTimer: number | null = null;
    private reverbSend: GainNode | null = null;
    private reverbReturn: ConvolverNode | null = null;
    private masterGain: GainNode | null = null;
    private compressor: DynamicsCompressorNode | null = null;
    private harmStep = 0;
    private melodyPos = 0;
    private activeNodes: { osc: OscillatorNode; stop: number }[] = [];

    /*
     * Harmonic progression — MIDI roots.
     * Slow, dreamy modal drift: Dmaj9 → Bm7 → Gmaj7 → Em9 → F#m7 → Amaj7 → Dmaj9
     * Each chord lasts ~10 seconds.
     */
    private readonly chords: { root: number; voicing: number[] }[] = [
        { root: 50, voicing: [50, 57, 64, 66, 69] }, // Dmaj9      D F# A B  C#  (add9)
        { root: 47, voicing: [47, 54, 59, 62, 66] }, // Bm7        B F# A  D  F#
        { root: 55, voicing: [55, 59, 62, 66, 71] }, // Gmaj7      G B  D  F# B
        { root: 52, voicing: [52, 56, 59, 64, 67] }, // Em9        E G# B  E  G
        { root: 54, voicing: [54, 57, 61, 64, 69] }, // F#m7       F# A C# E  A
        { root: 57, voicing: [57, 61, 64, 66, 69] }, // Amaj7      A  C# E F# A
        { root: 50, voicing: [50, 54, 57, 61, 66] }, // Dsus→maj   D  F# A C# F#
        { root: 55, voicing: [55, 59, 62, 67, 71] }, // G6/9       G  B  D  G  B
    ];

    /*
     * Melody fragments — short motifs that drift over the chords.
     * Written as semitone offsets from current chord root.
     * -1 = rest (silence). Sparse and unpredictable.
     */
    private readonly melodyFragments: number[][] = [
        [12, -1, -1, 16, -1, 14, -1, -1, -1, 12, -1, -1, 9, -1, -1, -1],
        [-1, -1, 7, -1, -1, 12, -1, 14, -1, -1, -1, -1, 16, -1, -1, -1],
        [24, -1, -1, -1, 21, -1, -1, -1, -1, 19, -1, -1, -1, -1, -1, -1],
        [-1, 9, -1, -1, -1, -1, 7, -1, -1, -1, 12, -1, -1, -1, -1, -1],
        [-1, -1, -1, 14, -1, -1, -1, -1, 12, -1, -1, 9, -1, -1, 7, -1],
        [-1, -1, -1, -1, -1, 19, -1, -1, -1, -1, 16, -1, -1, -1, -1, 14],
        [7, -1, -1, -1, -1, -1, -1, -1, 9, -1, -1, -1, -1, -1, -1, -1],
        [-1, -1, 12, -1, -1, -1, -1, -1, -1, -1, -1, 7, -1, -1, -1, -1],
    ];

    private ensure() {
        if (!this.actx) this.actx = new AudioContext();
        return this.actx;
    }

    async unlock() {
        const ctx = this.ensure();
        if (ctx.state === "suspended") {
            await ctx.resume();
        }
    }

    setSfxEnabled(enabled: boolean) {
        this.sfxEnabled = enabled;
        if (!enabled) this.maybeSuspend();
    }

    setMusicEnabled(enabled: boolean) {
        this.musicEnabled = enabled;
        if (!enabled) {
            this.stopMusic();
            return;
        }
        this.startMusic();
    }

    getSfxEnabled() {
        return this.sfxEnabled;
    }

    getMusicEnabled() {
        return this.musicEnabled;
    }

    /**
     * Battery: when the game is backgrounded, suspend the audio graph (the
     * convolver reverb costs real CPU even when silent) and stop the music
     * timers so oscillator nodes don't pile up while hidden.
     */
    handleVisibility(hidden: boolean) {
        const ctx = this.actx;
        if (!ctx) return;
        if (hidden) {
            this.clearTimers();
            void ctx.suspend();
        } else {
            if (this.sfxEnabled || this.musicEnabled) void ctx.resume();
            if (this.musicRunning) this.startTimers();
        }
    }

    /** Suspend the context when nothing can produce sound. */
    private maybeSuspend() {
        if (!this.sfxEnabled && !this.musicEnabled && !this.musicRunning && this.actx) {
            void this.actx.suspend();
        }
    }

    /* ═══════════════════════════════════════════════════════════════════════
     *  AMBIENT MUSIC ENGINE
     * ═══════════════════════════════════════════════════════════════════════ */

    startMusic() {
        if (!this.musicEnabled || this.musicRunning) return;
        this.musicRunning = true;
        const ctx = this.ensure();
        const now = ctx.currentTime;

        // ── master bus with gentle compression ──
        this.masterGain = ctx.createGain();
        this.masterGain.gain.setValueAtTime(0.0001, now);
        this.masterGain.gain.exponentialRampToValueAtTime(1, now + 3);

        this.compressor = ctx.createDynamicsCompressor();
        this.compressor.threshold.value = -20;
        this.compressor.knee.value = 14;
        this.compressor.ratio.value = 3;
        this.compressor.attack.value = 0.1;
        this.compressor.release.value = 0.3;
        this.masterGain.connect(this.compressor).connect(ctx.destination);

        // ── reverb ──
        this.reverbReturn = this.buildReverb(ctx, 3.5, 2.2);
        this.reverbReturn.connect(this.masterGain);
        this.reverbSend = ctx.createGain();
        this.reverbSend.gain.value = 0.6;
        this.reverbSend.connect(this.reverbReturn);

        // play first chord immediately
        this.harmStep = 0;
        this.melodyPos = 0;
        this.playChord();

        this.startTimers();
    }

    private startTimers() {
        this.clearTimers();
        // advance chords every ~10s
        this.musicTimer = window.setInterval(() => this.advanceHarmony(), 10000);
        // melody tick every ~650ms (slow, sparse)
        this.melodyTimer = window.setInterval(() => this.melodyTick(), 650);
    }

    private clearTimers() {
        if (this.musicTimer !== null) {
            clearInterval(this.musicTimer);
            this.musicTimer = null;
        }
        if (this.melodyTimer !== null) {
            clearInterval(this.melodyTimer);
            this.melodyTimer = null;
        }
    }

    private stopMusic() {
        this.musicRunning = false;
        const ctx = this.actx;
        if (!ctx) return;
        const now = ctx.currentTime;

        if (this.masterGain) {
            this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
            this.masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);
        }
        this.clearTimers();

        setTimeout(() => {
            for (const n of this.activeNodes) {
                try {
                    n.osc.stop();
                } catch {}
            }
            this.activeNodes = [];
            // Disconnect the whole music bus — an idle convolver still burns CPU
            this.reverbSend?.disconnect();
            this.reverbReturn?.disconnect();
            this.masterGain?.disconnect();
            this.compressor?.disconnect();
            this.reverbSend = null;
            this.reverbReturn = null;
            this.masterGain = null;
            this.compressor = null;
            this.maybeSuspend();
        }, 2000);
    }

    /* ── reverb impulse ── */
    private buildReverb(ctx: AudioContext, duration: number, decay: number): ConvolverNode {
        const rate = ctx.sampleRate;
        const length = Math.floor(rate * duration);
        const impulse = ctx.createBuffer(2, length, rate);
        for (let ch = 0; ch < 2; ch++) {
            const data = impulse.getChannelData(ch);
            for (let i = 0; i < length; i++) {
                const t = i / rate;
                const env = Math.exp(-t * decay) * (1 + 0.35 * Math.exp(-t * 22));
                data[i] = (Math.random() * 2 - 1) * env;
            }
        }
        const conv = ctx.createConvolver();
        conv.buffer = impulse;
        return conv;
    }

    /* ── play a sustained chord (voices fade in / out over ~9s) ── */
    private playChord() {
        if (!this.musicRunning || !this.actx || this.actx.state !== "running") return;
        const ctx = this.actx;
        const now = ctx.currentTime;
        const chord = this.chords[this.harmStep % this.chords.length];

        for (let i = 0; i < chord.voicing.length; i++) {
            const midi = chord.voicing[i];
            const freq = this.midiToFreq(midi);
            // two detuned oscillators per voice for warmth
            for (const detune of [-4, 4]) {
                const osc = ctx.createOscillator();
                osc.type = "sine";
                osc.frequency.value = freq;
                osc.detune.value = detune + (Math.random() - 0.5) * 2;

                const g = ctx.createGain();
                const vol = 0.007 + (i === 0 ? 0.004 : 0); // root slightly louder
                const attack = 1.8 + Math.random() * 1.2;
                const hold = 5 + Math.random() * 2;
                const release = hold + 2.5 + Math.random();
                const total = release + 0.5;

                g.gain.setValueAtTime(0.0001, now);
                g.gain.exponentialRampToValueAtTime(vol, now + attack);
                g.gain.setValueAtTime(vol, now + hold);
                g.gain.exponentialRampToValueAtTime(0.0001, now + release);

                osc.connect(g);
                g.connect(this.masterGain!);
                g.connect(this.reverbSend!);
                osc.start(now);
                osc.stop(now + total);
                this.activeNodes.push({ osc, stop: now + total });
            }
        }

        // cleanup old expired nodes
        this.activeNodes = this.activeNodes.filter((n) => n.stop > now);
    }

    /* ── advance to next chord ── */
    private advanceHarmony() {
        if (!this.musicRunning) return;
        this.harmStep = (this.harmStep + 1) % this.chords.length;
        this.playChord();
    }

    /* ── melody: play one note from the current fragment ── */
    private melodyTick() {
        if (!this.musicRunning || !this.actx) return;
        const ctx = this.actx;
        if (ctx.state !== "running") return;

        const fragIdx = this.harmStep % this.melodyFragments.length;
        const frag = this.melodyFragments[fragIdx];
        const step = this.melodyPos % frag.length;
        this.melodyPos++;

        const interval = frag[step];
        if (interval < 0) return; // rest

        const chord = this.chords[this.harmStep % this.chords.length];
        const midi = chord.root + interval;
        const freq = this.midiToFreq(midi);
        const now = ctx.currentTime;

        // soft bell-like tone
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = freq;

        // gentle vibrato via second oscillator
        const vib = ctx.createOscillator();
        vib.type = "sine";
        vib.frequency.value = 4.5 + Math.random();
        const vibG = ctx.createGain();
        vibG.gain.value = 1.5; // ±1.5 Hz
        vib.connect(vibG).connect(osc.frequency);
        vib.start(now);

        const g = ctx.createGain();
        const vol = 0.016 + Math.random() * 0.008;
        const dur = 2.8 + Math.random() * 2;
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(vol, now + 0.05);
        g.gain.exponentialRampToValueAtTime(vol * 0.5, now + dur * 0.4);
        g.gain.exponentialRampToValueAtTime(0.0001, now + dur);

        osc.connect(g);
        g.connect(this.masterGain!);
        g.connect(this.reverbSend!);
        osc.start(now);
        osc.stop(now + dur + 0.1);
        vib.stop(now + dur + 0.1);

        // quiet octave shimmer ~30% of the time
        if (Math.random() > 0.7) {
            const osc2 = ctx.createOscillator();
            osc2.type = "sine";
            osc2.frequency.value = freq * 2;
            const g2 = ctx.createGain();
            g2.gain.setValueAtTime(0.0001, now + 0.1);
            g2.gain.exponentialRampToValueAtTime(0.005, now + 0.16);
            g2.gain.exponentialRampToValueAtTime(0.0001, now + dur * 0.7);
            osc2.connect(g2);
            g2.connect(this.reverbSend!);
            osc2.start(now + 0.1);
            osc2.stop(now + dur);
        }
    }

    /* ═══════════════════════════════════════════════════════════════════════
     *  SFX
     * ═══════════════════════════════════════════════════════════════════════ */

    private midiToFreq(midi: number): number {
        return 440 * Math.pow(2, (midi - 69) / 12);
    }

    /** Play one short enveloped tone routed straight to the destination. */
    private tone(freq: number, o: ToneOpts) {
        const ctx = this.ensure();
        const t0 = ctx.currentTime + (o.at ?? 0);
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain).connect(ctx.destination);

        osc.type = o.type;
        osc.frequency.setValueAtTime(freq, t0);
        if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(o.freqEnd, t0 + (o.sweep ?? o.dur));
        if (o.detune) osc.detune.value = o.detune;

        const attack = o.attack ?? 0.015;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(o.vol, t0 + attack);
        if (o.hold) gain.gain.setValueAtTime(o.vol, t0 + o.hold);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + o.dur);

        osc.start(t0);
        osc.stop(t0 + o.dur + 0.05);
    }

    /** Play an ascending note sequence, one tone every `step` seconds. */
    private seq(freqs: number[], step: number, opts: Omit<ToneOpts, "at">) {
        freqs.forEach((freq, i) => this.tone(freq, { ...opts, at: i * step }));
    }

    pop() {
        if (!this.sfxEnabled) return;
        this.tone(600, { dur: 0.15, vol: 0.15, type: "sine", freqEnd: 1200, sweep: 0.08, attack: 0.005 });
    }

    move() {
        if (!this.sfxEnabled) return;
        this.tone(260, { dur: 0.18, vol: 0.08, type: "triangle", freqEnd: 520, sweep: 0.14, attack: 0.005 });
    }

    score() {
        if (!this.sfxEnabled) return;
        this.seq([523, 659, 784, 1047], 0.08, { dur: 0.2, vol: 0.1, type: "sine", attack: 0.005 });
    }

    combo() {
        if (!this.sfxEnabled) return;
        this.seq([659, 784, 988, 1318], 0.05, { dur: 0.16, vol: 0.12, type: "sine", attack: 0.005 });
    }

    /** Celebration sound for big clears. tier: 1=6 cells, 2=7 cells, 3=8+ cells */
    celebration(tier: number) {
        if (!this.sfxEnabled) return;

        if (tier === 1) {
            // Bright ascending sparkle: pentatonic run
            this.seq([784, 880, 1047, 1175, 1319], 0.06, { dur: 0.25, vol: 0.12, type: "sine", attack: 0.02 });
        } else if (tier === 2) {
            // Richer cascade with shimmer
            const notes = [659, 784, 988, 1175, 1319, 1568];
            notes.forEach((freq, i) => {
                for (const detune of [-6, 0, 6]) {
                    this.tone(freq, {
                        at: i * 0.055,
                        dur: 0.35,
                        vol: detune === 0 ? 0.13 : 0.04,
                        type: detune === 0 ? "sine" : "triangle",
                        attack: 0.02,
                        detune,
                    });
                }
            });
        } else {
            // Epic fanfare: chord burst + ascending run + shimmer tail
            this.seq([523, 659, 784, 1047], 0, { dur: 0.5, vol: 0.1, type: "sine", attack: 0.015 });
            const runNotes = [784, 988, 1175, 1319, 1568, 1760, 2093];
            runNotes.forEach((freq, i) =>
                this.tone(freq, { at: 0.1 + i * 0.05, dur: 0.3, vol: 0.11, type: "sine", attack: 0.02 }),
            );
            for (let i = 0; i < 4; i++) {
                this.tone(1568 + Math.random() * 800, {
                    at: 0.45 + i * 0.08,
                    dur: 0.5,
                    vol: 0.05,
                    type: "triangle",
                    attack: 0.02,
                });
            }
        }
    }

    error() {
        if (!this.sfxEnabled) return;
        this.tone(200, { dur: 0.2, vol: 0.08, type: "square", freqEnd: 100, sweep: 0.15, attack: 0.005 });
    }

    gameOver() {
        if (!this.sfxEnabled) return;
        // Triumphant ascending fanfare: C5 → E5 → G5 → C6
        const notes = [523, 659, 784, 1047];
        notes.forEach((freq, i) =>
            this.tone(freq, { at: i * 0.12, dur: 0.45, vol: 0.14, type: "sine", attack: 0.04, hold: 0.18 }),
        );
        // Final shimmering octave chord
        for (const freq of [1047, 1318, 1568]) {
            this.tone(freq, { at: 0.48, dur: 1.0, vol: 0.08, type: "triangle", attack: 0.06 });
        }
    }
}

// ─── Game state ──────────────────────────────────────────────────────────────

enum Phase {
    SELECT, // Waiting for user to select a cell
    MOVE_ANIM, // Playing movement animation
    REMOVE_ANIM, // Playing removal animation
    SPAWN_ANIM, // Playing spawn animation
    GAME_OVER,
}

// ─── Controller ──────────────────────────────────────────────────────────────

// Sound mode: 0=off, 1=effects only, 2=music only, 3=effects+music
type SoundMode = 0 | 1 | 2 | 3;

// Adaptive frame pacing: full rate only while something is animating.
// (Also caps 120Hz ProMotion displays at 60fps — rAF alone would run at 120.)
const BUSY_FRAME_MS = 1000 / 60;
const IDLE_FRAME_MS = 1000 / 30;

class AtomiconGame {
    private grid: Grid;
    private renderer: Renderer;
    private sfx = new SFX();
    private phase = Phase.SELECT;
    private selected: Position | null = null;
    private score = 0;
    private combo = 0;
    private moveCount = 0;
    private best: number;
    private nextColors: CellColor[] = [];
    private pendingRemove: Set<string> | null = null;
    private soundMode: SoundMode = 3;
    private lastFrame = 0;

    // DOM refs
    private scoreEl: HTMLElement;
    private bestEl: HTMLElement;
    private messageEl: HTMLElement;
    private nextDots: HTMLElement[];
    private overlay: HTMLElement;
    private finalScoreEl: HTMLElement;
    private topScoresEl: HTMLElement | null;
    private soundToggleBtn: HTMLButtonElement;

    private readonly leaderboardKey = "atomicon_leaderboard";

    constructor() {
        const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
        this.renderer = new Renderer(canvas);
        this.grid = createEmptyGrid();

        this.scoreEl = document.getElementById("score")!;
        this.bestEl = document.getElementById("best")!;
        this.messageEl = document.getElementById("message")!;
        this.overlay = document.getElementById("overlay")!;
        this.finalScoreEl = document.getElementById("final-score")!;
        this.topScoresEl = document.getElementById("top-scores");
        this.soundToggleBtn = document.getElementById("sound-toggle") as HTMLButtonElement;
        this.nextDots = [];
        for (let i = 0; i < PREVIEW_SIZE; i++) {
            const dot = document.getElementById(`next${i}`);
            if (dot) this.nextDots.push(dot);
        }

        // Load sound mode from localStorage
        const savedSoundMode = localStorage.getItem("atomicon_sound_mode");
        if (savedSoundMode !== null) {
            this.soundMode = parseInt(savedSoundMode, 10) as SoundMode;
        }
        this.applySoundMode();

        this.best = parseInt(localStorage.getItem("atomicon_best") || "0", 10);
        this.bestEl.textContent = String(this.best);

        // Event listeners
        canvas.addEventListener("click", (e) => this.handleClick(e));
        document.getElementById("new-game-btn")!.addEventListener("click", () => this.newGame());
        document.getElementById("play-again-btn")!.addEventListener("click", () => this.newGame());
        this.soundToggleBtn.addEventListener("click", () => this.cycleSoundMode());
        window.addEventListener("keydown", (e) => this.handleHotkeys(e));

        // Battery: silence the audio graph while the game is backgrounded
        document.addEventListener("visibilitychange", () => this.sfx.handleVisibility(document.hidden));

        let resizeTimer: ReturnType<typeof setTimeout> | undefined;
        const scheduleResize = (delay = 150) => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => this.renderer.resize(), delay);
        };
        window.addEventListener("resize", () => scheduleResize());
        window.addEventListener("orientationchange", () => scheduleResize(300));
        if (window.visualViewport) {
            window.visualViewport.addEventListener("resize", () => scheduleResize());
        }

        // Animation completion callback
        this.renderer.onAnimationComplete = () => this.onAnimComplete();

        this.newGame();
        requestAnimationFrame(this.loop);
        this.syncSoundButton();
        void this.sfx.unlock().then(() => {
            if (this.soundMode >= 2) this.sfx.startMusic();
        });
    }

    private handleHotkeys(e: KeyboardEvent) {
        if (e.key.toLowerCase() === "m" || e.key.toLowerCase() === "s") {
            this.cycleSoundMode();
        }
    }

    private cycleSoundMode() {
        this.soundMode = ((this.soundMode + 1) % 4) as SoundMode;
        localStorage.setItem("atomicon_sound_mode", String(this.soundMode));
        this.applySoundMode();
        this.syncSoundButton();
    }

    private applySoundMode() {
        const sfxOn = this.soundMode === 1 || this.soundMode === 3;
        const musicOn = this.soundMode === 2 || this.soundMode === 3;
        this.sfx.setSfxEnabled(sfxOn);
        this.sfx.setMusicEnabled(musicOn);
        if (this.soundMode > 0) {
            void this.sfx.unlock().then(() => {
                if (musicOn) this.sfx.startMusic();
            });
        }
    }

    private syncSoundButton() {
        const icons: Record<SoundMode, string> = {
            0: "\u{1F507}", // muted
            1: "\u{1F509}", // effects only (low volume)
            2: "\u{1F3B5}", // music only (note)
            3: "\u{1F50A}", // all on (loud speaker)
        };
        const titles: Record<SoundMode, string> = {
            0: "Sound: OFF",
            1: "Sound: Effects",
            2: "Sound: Music",
            3: "Sound: All",
        };
        this.soundToggleBtn.textContent = icons[this.soundMode];
        this.soundToggleBtn.title = titles[this.soundMode];
        this.soundToggleBtn.classList.toggle("off", this.soundMode === 0);
    }

    private getLeaderboard(): number[] {
        const raw = localStorage.getItem(this.leaderboardKey);
        if (!raw) return [];
        try {
            const parsed = JSON.parse(raw) as unknown;
            if (!Array.isArray(parsed)) return [];
            return parsed
                .map((item) => Number(item))
                .filter((v) => Number.isFinite(v) && v >= 0)
                .sort((a, b) => b - a)
                .slice(0, 5);
        } catch {
            return [];
        }
    }

    private submitLeaderboard(score: number) {
        const scores = this.getLeaderboard();
        scores.push(score);
        scores.sort((a, b) => b - a);
        localStorage.setItem(this.leaderboardKey, JSON.stringify(scores.slice(0, 5)));
    }

    // ─── Game lifecycle ────────────────────────────────────────────────────

    private newGame() {
        this.grid = createEmptyGrid();
        this.score = 0;
        this.combo = 0;
        this.moveCount = 0;
        this.selected = null;
        this.pendingRemove = null;
        this.phase = Phase.SELECT;
        this.overlay.classList.remove("visible");
        this.renderer.setSelected(null);

        this.nextColors = generateNextColors(PREVIEW_SIZE, this.moveCount);
        spawnCells(this.grid, generateNextColors(6, this.moveCount));

        this.updateUI();
        this.setMessage("Select a cell to move");
    }

    private updateUI() {
        this.scoreEl.textContent = String(this.score);
        this.bestEl.textContent = String(this.best);

        // Pass combo level to renderer for particle effects
        this.renderer.setComboLevel(this.combo);

        const occupied = countOccupied(this.grid);
        const spawnCount = getSpawnCount(this.moveCount, occupied / VALID_CELL_COUNT);

        // Next preview dots — hide dots beyond spawnCount entirely
        for (let i = 0; i < this.nextDots.length; i++) {
            if (i >= spawnCount) {
                this.nextDots[i].classList.add("hidden");
                continue;
            }
            this.nextDots[i].classList.remove("hidden");
            const color = this.nextColors[i];
            this.nextDots[i].style.background =
                color !== undefined ? this.renderer.getThemeColor(color) : "transparent";
            this.nextDots[i].style.opacity = "1";
        }
    }

    private setMessage(msg: string) {
        this.messageEl.textContent = msg;
    }

    // ─── Click handling ────────────────────────────────────────────────────

    private handleClick(e: MouseEvent) {
        if (this.phase !== Phase.SELECT) return;
        void this.sfx.unlock().then(() => this.sfx.startMusic());

        const rect = this.renderer.getCanvas().getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const pos = this.renderer.getCellFromPixel(x, y);
        if (!pos) return;

        const cellColor = this.grid[pos.row][pos.col].color;

        if (cellColor >= 0) {
            // Select (or re-select) a micro
            this.selected = pos;
            this.renderer.setSelected(pos);
            this.sfx.pop();
            this.setMessage("Select destination");
            return;
        }

        if (this.selected === null) return;

        // Try to move
        const path = findPath(this.grid, this.selected, pos);
        if (!path || path.length === 0) {
            this.sfx.error();
            this.setMessage("No path! Try another cell");
            return;
        }

        // Execute move
        this.phase = Phase.MOVE_ANIM;
        const movingColor = this.grid[this.selected.row][this.selected.col].color;

        // Clear source
        this.grid[this.selected.row][this.selected.col].color = -1;
        // Set destination (so line check after anim works)
        this.grid[pos.row][pos.col].color = movingColor;

        // Build full path including source
        const fullPath = [this.selected, ...path];

        this.renderer.setSelected(null);
        this.renderer.startPathAnimation(fullPath, movingColor);
        this.sfx.move();
        this.selected = null;
        this.setMessage("");
    }

    // ─── Animation complete callback ────────────────────────────────────

    /**
     * Score any lines on the board and kick off the removal animation.
     * Returns false when there was nothing to clear.
     */
    private handleClears(comboLabel: string): boolean {
        const { toRemove, score } = checkLines(this.grid);
        if (toRemove.size === 0) {
            this.combo = 0;
            return false;
        }

        this.combo++;
        const comboBonus = this.combo > 1 ? Math.floor(score * 0.2 * (this.combo - 1)) : 0;
        const turnScore = score + comboBonus;
        this.score += turnScore;
        if (this.score > this.best) {
            this.best = this.score;
            localStorage.setItem("atomicon_best", String(this.best));
        }

        this.pendingRemove = toRemove;
        this.phase = Phase.REMOVE_ANIM;
        this.renderer.startRemoveAnimation(toRemove);
        this.triggerCelebration(toRemove);
        if (this.combo > 1) {
            this.sfx.combo();
            this.setMessage(`${comboLabel} x${this.combo}! +${turnScore}`);
        } else {
            this.sfx.score();
            this.setMessage(`+${turnScore} points`);
        }
        this.updateUI();
        return true;
    }

    private onAnimComplete() {
        switch (this.phase) {
            case Phase.MOVE_ANIM:
                this.moveCount++;
                if (!this.handleClears("Combo")) this.spawnPhase();
                return;

            case Phase.REMOVE_ANIM:
                if (this.pendingRemove) {
                    removeMatches(this.grid, this.pendingRemove);
                    this.pendingRemove = null;
                }
                // Cleared the whole board? Spawn instead of stranding the player.
                if (countOccupied(this.grid) === 0) {
                    this.spawnPhase();
                    return;
                }
                this.phase = Phase.SELECT;
                this.setMessage("Select a cell to move");
                this.updateUI();
                return;

            case Phase.SPAWN_ANIM:
                if (this.handleClears("Chain combo")) return;
                if (isBoardFull(this.grid) || !hasAnyMove(this.grid)) {
                    this.gameOver();
                    return;
                }
                this.phase = Phase.SELECT;
                this.setMessage("Select a cell to move");
                this.updateUI();
                return;
        }
    }

    /** Trigger celebration effects when clearing 6+ cells */
    private triggerCelebration(toRemove: Set<string>) {
        const tier = toRemove.size >= 8 ? 3 : toRemove.size >= 7 ? 2 : toRemove.size >= 6 ? 1 : 0;
        if (tier > 0) {
            this.renderer.startCelebration(toRemove, tier);
            this.sfx.celebration(tier);
        }
    }

    private spawnPhase() {
        const occupiedRatio = countOccupied(this.grid) / VALID_CELL_COUNT;
        const spawnCount = getSpawnCount(this.moveCount, occupiedRatio);
        const spawnColors = this.nextColors.slice(0, spawnCount);

        const placed = spawnCells(this.grid, spawnColors);
        this.nextColors = generateNextColors(PREVIEW_SIZE, this.moveCount);
        this.updateUI();

        if (placed.length > 0) {
            this.phase = Phase.SPAWN_ANIM;
            this.renderer.startSpawnAnimation(placed);
            this.setMessage(`Spawned ${placed.length} cells`);
        } else {
            // Board is full
            this.gameOver();
        }
    }

    private gameOver() {
        this.phase = Phase.GAME_OVER;
        this.sfx.gameOver();
        this.submitLeaderboard(this.score);
        this.finalScoreEl.textContent = String(this.score);
        this.renderTopScores();
        this.overlay.classList.add("visible");
        this.setMessage("Game Over");
    }

    private renderTopScores() {
        if (!this.topScoresEl) return;
        this.topScoresEl.textContent = "";
        let highlighted = false;
        for (const value of this.getLeaderboard()) {
            const li = document.createElement("li");
            li.textContent = String(value);
            if (!highlighted && value === this.score) {
                li.classList.add("current");
                highlighted = true;
            }
            this.topScoresEl.appendChild(li);
        }
    }

    // ─── Render loop ───────────────────────────────────────────────────────

    /**
     * Adaptive frame pacing: 60fps while animating, 30fps when the board is
     * idle (characters still bob and blink — the sprite phases advance ~5x/s).
     * rAF itself stops while the tab is hidden, so a backgrounded game costs
     * nothing.
     */
    private loop = (now: number) => {
        requestAnimationFrame(this.loop);
        const interval = this.renderer.isBusy() ? BUSY_FRAME_MS : IDLE_FRAME_MS;
        if (now - this.lastFrame < interval - 2) return;
        this.lastFrame = now;
        this.renderer.draw(this.grid);
    };
}

// ─── Boot ────────────────────────────────────────────────────────────────────

new AtomiconGame();
