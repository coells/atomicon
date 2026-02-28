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

// ─── Sound FX (tiny synthesized sounds) ──────────────────────────────────────

class SFX {
    private actx: AudioContext | null = null;
    private musicTimer: number | null = null;
    private musicStep = 0;
    private songIndex = 0;
    private sfxEnabled = true;
    private musicEnabled = true;

    private readonly musicTickMs = 420;

    private readonly songs = [
        {
            name: "Gymnopedie Mood",
            melody: [
                66, -1, 69, -1, 71, -1, 69, -1, 66, -1, 64, -1, 62, -1, 64, -1, 66, -1, 69, -1, 71, -1, 73, -1, 71, -1,
                69, -1, 66, -1, 64, -1, 62, -1, 64, -1, 66, -1, 69, -1, 71, -1, 69, -1, 66, -1, 64, -1, 62, -1, 61, -1,
                62, -1, 64, -1, 66, -1, 64, -1, 62, -1, 59, -1,
            ],
            bass: [
                42, -1, -1, -1, 49, -1, -1, -1, 45, -1, -1, -1, 52, -1, -1, -1, 42, -1, -1, -1, 49, -1, -1, -1, 40, -1,
                -1, -1, 47, -1, -1, -1,
            ],
            chordRoots: [54, 61, 57, 64, 54, 61, 52, 59],
        },
    ] as const;

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
            if (this.musicTimer !== null) {
                window.clearInterval(this.musicTimer);
                this.musicTimer = null;
            }
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

    startMusic() {
        if (!this.musicEnabled || this.musicTimer !== null) return;
        this.musicStep = 0;
        this.songIndex = 0;
        this.musicTimer = window.setInterval(() => {
            if (!this.musicEnabled) return;
            this.playMusicStep();
        }, this.musicTickMs);
    }

    private midiToFreq(midi: number): number {
        return 440 * Math.pow(2, (midi - 69) / 12);
    }

    private playTone(
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

    private playMusicStep() {
        const ctx = this.ensure();
        if (ctx.state !== "running") return;

        const song = this.songs[this.songIndex % this.songs.length];
        const step = this.musicStep % song.melody.length;

        const melodyMidi = song.melody[step];
        if (melodyMidi >= 0) {
            const melodyFreq = this.midiToFreq(melodyMidi);
            this.playTone(melodyFreq, {
                duration: 0.72,
                volume: 0.024,
                type: "sine",
                attack: 0.04,
                release: 0.66,
            });

            if (step % 8 === 0 || Math.random() > 0.9) {
                this.playTone(melodyFreq * 2, {
                    duration: 0.58,
                    volume: 0.006,
                    type: "sine",
                    attack: 0.06,
                    release: 0.54,
                    detune: 2,
                });
            }
        }

        if (step % 2 === 0) {
            const bass = song.bass[(step / 2) % song.bass.length];
            if (bass >= 0) {
                this.playTone(this.midiToFreq(bass), {
                    duration: 1.35,
                    volume: 0.012,
                    type: "triangle",
                    attack: 0.06,
                    release: 1.2,
                });
            }
        }

        if (step % 4 === 0) {
            const root = song.chordRoots[(step / 4) % song.chordRoots.length];
            const chord = [root, root + 3, root + 7, root + 10];
            chord.forEach((midi, idx) => {
                this.playTone(this.midiToFreq(midi), {
                    duration: 1.68,
                    volume: 0.007 / (idx + 1),
                    type: "sine",
                    attack: 0.08,
                    release: 1.45,
                    detune: idx,
                });
            });
        }

        this.musicStep++;
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
