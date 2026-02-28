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

class SFX {
    private actx: AudioContext | null = null;
    private sfxEnabled = true;
    private musicEnabled = true;

    /* ── ambient music engine state ── */
    private musicRunning = false;
    private musicTimer: number | null = null;
    private reverbSend: GainNode | null = null;
    private reverbReturn: ConvolverNode | null = null;
    private masterGain: GainNode | null = null;
    private harmStep = 0;
    private melodyPos = 0;
    private melodyTimer: number | null = null;
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

    private readonly baseMidi = 50; // D3

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

        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -20;
        compressor.knee.value = 14;
        compressor.ratio.value = 3;
        compressor.attack.value = 0.1;
        compressor.release.value = 0.3;
        this.masterGain.connect(compressor).connect(ctx.destination);

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

        // advance chords every ~10s
        this.musicTimer = window.setInterval(() => this.advanceHarmony(), 10000);

        // melody tick every ~650ms (slow, sparse)
        this.melodyTimer = window.setInterval(() => this.melodyTick(), 650);
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
        if (this.musicTimer !== null) {
            clearInterval(this.musicTimer);
            this.musicTimer = null;
        }
        if (this.melodyTimer !== null) {
            clearInterval(this.melodyTimer);
            this.melodyTimer = null;
        }

        setTimeout(() => {
            for (const n of this.activeNodes) {
                try {
                    n.osc.stop();
                } catch {}
            }
            this.activeNodes = [];
            this.reverbSend = null;
            this.reverbReturn = null;
            this.masterGain = null;
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
        if (!this.musicRunning || !this.actx) return;
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

    private rootFreq() {
        return this.midiToFreq(this.chords[this.harmStep % this.chords.length].root);
    }

    /* ═══════════════════════════════════════════════════════════════════════
     *  SFX HELPERS
     * ═══════════════════════════════════════════════════════════════════════ */

    private midiToFreq(midi: number): number {
        return 440 * Math.pow(2, (midi - 69) / 12);
    }

    /** Play a short SFX tone routed to destination (bypasses music bus). */
    private playSfxTone(
        frequency: number,
        opts: {
            duration: number;
            volume: number;
            type: OscillatorType;
            attack?: number;
            release?: number;
            detune?: number;
        },
    ) {
        const ctx = this.ensure();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.type = opts.type;
        osc.frequency.value = frequency;
        if (opts.detune) osc.detune.value = opts.detune;

        const now = ctx.currentTime;
        const attack = opts.attack ?? 0.02;
        const release = opts.release ?? opts.duration;

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(opts.volume, now + attack);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + release);

        osc.start(now);
        osc.stop(now + opts.duration);
    }

    pop() {
        if (!this.sfxEnabled) return;
        const ctx = this.ensure();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(600, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.15);
    }

    move() {
        if (!this.sfxEnabled) return;
        const ctx = this.ensure();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "triangle";
        osc.frequency.setValueAtTime(260, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(520, ctx.currentTime + 0.14);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.18);
    }

    score() {
        if (!this.sfxEnabled) return;
        const ctx = this.ensure();
        const notes = [523, 659, 784, 1047];
        notes.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = "sine";
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.1, ctx.currentTime + i * 0.08);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.08 + 0.2);
            osc.start(ctx.currentTime + i * 0.08);
            osc.stop(ctx.currentTime + i * 0.08 + 0.2);
        });
    }

    combo() {
        if (!this.sfxEnabled) return;
        const ctx = this.ensure();
        const notes = [659, 784, 988, 1318];
        notes.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = "sine";
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.12, ctx.currentTime + i * 0.05);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.05 + 0.16);
            osc.start(ctx.currentTime + i * 0.05);
            osc.stop(ctx.currentTime + i * 0.05 + 0.16);
        });
    }

    error() {
        if (!this.sfxEnabled) return;
        const ctx = this.ensure();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "square";
        osc.frequency.setValueAtTime(200, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.2);
    }

    gameOver() {
        if (!this.sfxEnabled) return;
        const ctx = this.ensure();
        const notes = [400, 350, 300, 200];
        notes.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = "sine";
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.12, ctx.currentTime + i * 0.15);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.3);
            osc.start(ctx.currentTime + i * 0.15);
            osc.stop(ctx.currentTime + i * 0.15 + 0.3);
        });
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
    private pendingLineScore = 0;
    private pendingLineCount = 0;

    // DOM refs
    private scoreEl: HTMLElement;
    private bestEl: HTMLElement;
    private messageEl: HTMLElement;
    private nextDots: HTMLElement[];
    private difficultyEl: HTMLElement;
    private comboEl: HTMLElement;
    private overlay: HTMLElement;
    private finalScoreEl: HTMLElement;
    private leaderboardEl: HTMLOListElement;
    private toggleSfxBtn: HTMLButtonElement;
    private toggleMusicBtn: HTMLButtonElement;

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
        this.leaderboardEl = document.getElementById("leaderboard") as HTMLOListElement;
        this.toggleSfxBtn = document.getElementById("toggle-sfx-btn") as HTMLButtonElement;
        this.toggleMusicBtn = document.getElementById("toggle-music-btn") as HTMLButtonElement;
        this.nextDots = [];
        for (let i = 0; i < PREVIEW_SIZE; i++) {
            const dot = document.getElementById(`next${i}`);
            if (dot) this.nextDots.push(dot);
        }
        this.difficultyEl = document.getElementById("difficulty")!;
        this.comboEl = document.getElementById("combo")!;

        const savedSfx = localStorage.getItem("atomicon_sfx");
        const savedMusic = localStorage.getItem("atomicon_music");
        this.sfx.setSfxEnabled(savedSfx !== "off");
        this.sfx.setMusicEnabled(savedMusic !== "off");

        this.best = parseInt(localStorage.getItem("atomicon_best") || "0", 10);
        this.bestEl.textContent = String(this.best);

        // Event listeners
        canvas.addEventListener("click", (e) => this.handleClick(e));
        document.getElementById("new-game-btn")!.addEventListener("click", () => this.newGame());
        document.getElementById("play-again-btn")!.addEventListener("click", () => this.newGame());
        this.toggleSfxBtn.addEventListener("click", () => this.toggleSfx());
        this.toggleMusicBtn.addEventListener("click", () => this.toggleMusic());
        window.addEventListener("keydown", (e) => this.handleHotkeys(e));

        window.addEventListener("resize", () => {
            this.renderer.resize();
        });

        // Animation completion callback
        this.renderer.onAnimationComplete = () => this.onAnimComplete();

        this.newGame();
        this.loop();
        this.syncAudioButtons();
        this.renderLeaderboard();
        void this.sfx.unlock().then(() => this.sfx.startMusic());
    }

    private handleHotkeys(e: KeyboardEvent) {
        if (e.key.toLowerCase() === "m") {
            this.toggleMusic();
        }
        if (e.key.toLowerCase() === "s") {
            this.toggleSfx();
        }
    }

    private toggleSfx() {
        this.sfx.setSfxEnabled(!this.sfx.getSfxEnabled());
        localStorage.setItem("atomicon_sfx", this.sfx.getSfxEnabled() ? "on" : "off");
        this.syncAudioButtons();
    }

    private toggleMusic() {
        const next = !this.sfx.getMusicEnabled();
        this.sfx.setMusicEnabled(next);
        localStorage.setItem("atomicon_music", next ? "on" : "off");
        this.syncAudioButtons();
        if (next) {
            void this.sfx.unlock().then(() => this.sfx.startMusic());
        }
    }

    private syncAudioButtons() {
        this.toggleSfxBtn.textContent = `SFX: ${this.sfx.getSfxEnabled() ? "ON" : "OFF"}`;
        this.toggleMusicBtn.textContent = `Music: ${this.sfx.getMusicEnabled() ? "ON" : "OFF"}`;
        this.toggleSfxBtn.classList.toggle("off", !this.sfx.getSfxEnabled());
        this.toggleMusicBtn.classList.toggle("off", !this.sfx.getMusicEnabled());
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

    private storeLeaderboard(scores: number[]) {
        localStorage.setItem(this.leaderboardKey, JSON.stringify(scores.slice(0, 5)));
    }

    private submitLeaderboard(score: number) {
        const scores = this.getLeaderboard();
        scores.push(score);
        scores.sort((a, b) => b - a);
        this.storeLeaderboard(scores.slice(0, 5));
        this.renderLeaderboard();
    }

    private renderLeaderboard() {
        const scores = this.getLeaderboard();
        const rows = Array.from({ length: 5 }, (_, i) => {
            const value = scores[i] ?? 0;
            return `<li><span>#${i + 1}</span><strong>${value}</strong></li>`;
        });
        this.leaderboardEl.innerHTML = rows.join("");
    }

    // ─── Game lifecycle ────────────────────────────────────────────────────

    private newGame() {
        this.grid = createEmptyGrid();
        this.score = 0;
        this.combo = 0;
        this.moveCount = 0;
        this.selected = null;
        this.pendingRemove = null;
        this.pendingLineScore = 0;
        this.pendingLineCount = 0;
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
        this.comboEl.textContent = this.combo > 1 ? `x${this.combo}` : "-";

        const occupied = countOccupied(this.grid);
        const spawnCount = getSpawnCount(this.moveCount, occupied / VALID_CELL_COUNT);
        this.difficultyEl.textContent = `${spawnCount} / turn`;

        // Next preview dots
        for (let i = 0; i < this.nextDots.length; i++) {
            const color = this.nextColors[i];
            this.nextDots[i].style.background =
                color !== undefined ? this.renderer.getThemeColor(color) : "transparent";
            this.nextDots[i].style.opacity = i < spawnCount ? "1" : "0.42";
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

        if (this.selected === null) {
            // Select a cell with a micro
            if (cellColor >= 0) {
                this.selected = pos;
                this.renderer.setSelected(pos);
                this.sfx.pop();
                this.setMessage("Select destination");
            }
        } else {
            // Second click
            if (cellColor >= 0) {
                // Re-select a different micro
                this.selected = pos;
                this.renderer.setSelected(pos);
                this.sfx.pop();
                this.setMessage("Select destination");
                return;
            }

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
    }

    // ─── Animation complete callback ────────────────────────────────────

    private onAnimComplete() {
        if (this.phase === Phase.MOVE_ANIM) {
            this.moveCount++;
            // Check for lines
            const { toRemove, score, lineCount } = checkLines(this.grid);
            if (toRemove.size > 0) {
                this.combo++;
                const comboBonus = this.combo > 1 ? Math.floor(score * 0.2 * (this.combo - 1)) : 0;
                const turnScore = score + comboBonus;
                this.score += turnScore;
                if (this.score > this.best) {
                    this.best = this.score;
                    localStorage.setItem("atomicon_best", String(this.best));
                }
                this.pendingRemove = toRemove;
                this.pendingLineScore = turnScore;
                this.pendingLineCount = lineCount;
                this.phase = Phase.REMOVE_ANIM;
                this.renderer.startRemoveAnimation(toRemove);
                if (this.combo > 1) {
                    this.sfx.combo();
                    this.setMessage(`Combo x${this.combo}! +${turnScore}`);
                } else {
                    this.sfx.score();
                    this.setMessage(`+${turnScore} points`);
                }
                this.updateUI();
                return;
            }

            this.combo = 0;
            // No score — spawn new cells
            this.spawnPhase();
            return;
        }

        if (this.phase === Phase.REMOVE_ANIM) {
            if (this.pendingRemove) {
                removeMatches(this.grid, this.pendingRemove);
            }
            this.pendingRemove = null;
            this.pendingLineScore = 0;
            this.pendingLineCount = 0;

            if (!hasAnyMove(this.grid) || isBoardFull(this.grid)) {
                this.gameOver();
                return;
            }

            this.phase = Phase.SELECT;
            this.setMessage("Select a cell to move");
            this.updateUI();
            return;
        }

        if (this.phase === Phase.SPAWN_ANIM) {
            // Check if spawned cells create lines
            const { toRemove, score } = checkLines(this.grid);
            if (toRemove.size > 0) {
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
                if (this.combo > 1) {
                    this.sfx.combo();
                    this.setMessage(`Chain combo x${this.combo}! +${turnScore}`);
                } else {
                    this.sfx.score();
                    this.setMessage(`+${turnScore} points`);
                }
                this.updateUI();
                return;
            }

            this.combo = 0;
            // Check game over
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
        this.overlay.classList.add("visible");
        this.setMessage("Game Over");
    }

    // ─── Render loop ───────────────────────────────────────────────────────

    private loop = () => {
        this.renderer.draw(this.grid);
        requestAnimationFrame(this.loop);
    };
}

// ─── Boot ────────────────────────────────────────────────────────────────────

new AtomiconGame();
