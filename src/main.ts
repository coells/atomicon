import {
    checkLines,
    createEmptyGrid,
    findPath,
    generateNextColors,
    isBoardFull,
    removeMatches,
    spawnCells,
    type CellColor,
    type Grid,
    type Position,
} from "./game";
import { Renderer } from "./renderer";

// ─── Sound FX (tiny synthesized sounds) ──────────────────────────────────────

class SFX {
    private actx: AudioContext | null = null;

    private ensure() {
        if (!this.actx) this.actx = new AudioContext();
        return this.actx;
    }

    pop() {
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

    score() {
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

    error() {
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

class MicroCellsGame {
    private grid: Grid;
    private renderer: Renderer;
    private sfx = new SFX();
    private phase = Phase.SELECT;
    private selected: Position | null = null;
    private score = 0;
    private best: number;
    private nextColors: CellColor[] = [];
    private pendingMoveTarget: Position | null = null;

    // DOM refs
    private scoreEl: HTMLElement;
    private bestEl: HTMLElement;
    private messageEl: HTMLElement;
    private nextDots: HTMLElement[];
    private overlay: HTMLElement;
    private finalScoreEl: HTMLElement;

    constructor() {
        const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
        this.renderer = new Renderer(canvas);
        this.grid = createEmptyGrid();

        this.scoreEl = document.getElementById("score")!;
        this.bestEl = document.getElementById("best")!;
        this.messageEl = document.getElementById("message")!;
        this.overlay = document.getElementById("overlay")!;
        this.finalScoreEl = document.getElementById("final-score")!;
        this.nextDots = [
            document.getElementById("next0")!,
            document.getElementById("next1")!,
            document.getElementById("next2")!,
        ];

        this.best = parseInt(localStorage.getItem("microcells_best") || "0", 10);
        this.bestEl.textContent = String(this.best);

        // Event listeners
        canvas.addEventListener("click", (e) => this.handleClick(e));
        document.getElementById("new-game-btn")!.addEventListener("click", () => this.newGame());
        document.getElementById("play-again-btn")!.addEventListener("click", () => this.newGame());

        window.addEventListener("resize", () => {
            this.renderer.resize();
        });

        // Animation completion callback
        this.renderer.onAnimationComplete = () => this.onAnimComplete();

        this.newGame();
        this.loop();
    }

    // ─── Game lifecycle ────────────────────────────────────────────────────

    private newGame() {
        this.grid = createEmptyGrid();
        this.score = 0;
        this.selected = null;
        this.phase = Phase.SELECT;
        this.overlay.classList.remove("visible");

        this.nextColors = generateNextColors();
        // Initial spawn of 5 cells
        const initialColors = Array.from({ length: 5 }, () => Math.floor(Math.random() * 7));
        spawnCells(this.grid, initialColors);

        this.updateUI();
    }

    private updateUI() {
        this.scoreEl.textContent = String(this.score);
        this.bestEl.textContent = String(this.best);

        // Next preview dots
        for (let i = 0; i < 3; i++) {
            const color = this.nextColors[i];
            this.nextDots[i].style.background =
                color !== undefined ? this.renderer.getThemeColor(color) : "transparent";
        }
    }

    private setMessage(msg: string) {
        this.messageEl.textContent = msg;
    }

    // ─── Click handling ────────────────────────────────────────────────────

    private handleClick(e: MouseEvent) {
        if (this.phase !== Phase.SELECT) return;

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
            this.pendingMoveTarget = pos;
            const movingColor = this.grid[this.selected.row][this.selected.col].color;

            // Clear source
            this.grid[this.selected.row][this.selected.col].color = -1;
            // Set destination (so line check after anim works)
            this.grid[pos.row][pos.col].color = movingColor;

            // Build full path including source
            const fullPath = [this.selected, ...path];

            this.renderer.setSelected(null);
            this.renderer.startPathAnimation(fullPath, movingColor);
            this.selected = null;
            this.setMessage("");
        }
    }

    // ─── Animation complete callback ────────────────────────────────────

    private onAnimComplete() {
        if (this.phase === Phase.MOVE_ANIM) {
            // Check for lines
            const { toRemove, score } = checkLines(this.grid);
            if (toRemove.size > 0) {
                this.score += score;
                if (this.score > this.best) {
                    this.best = this.score;
                    localStorage.setItem("microcells_best", String(this.best));
                }
                this.sfx.score();
                this.phase = Phase.REMOVE_ANIM;
                this.renderer.startRemoveAnimation(toRemove);
                this.setMessage(`+${score} points!`);
                this.updateUI();
                return;
            }

            // No score — spawn new cells
            this.spawnPhase();
            return;
        }

        if (this.phase === Phase.REMOVE_ANIM) {
            // Actually remove cells from grid
            const { toRemove } = checkLines(this.grid);
            removeMatches(this.grid, toRemove);
            this.phase = Phase.SELECT;
            this.setMessage("Select a cell to move");
            this.updateUI();
            return;
        }

        if (this.phase === Phase.SPAWN_ANIM) {
            // Check if spawned cells create lines
            const { toRemove, score } = checkLines(this.grid);
            if (toRemove.size > 0) {
                this.score += score;
                if (this.score > this.best) {
                    this.best = this.score;
                    localStorage.setItem("microcells_best", String(this.best));
                }
                this.sfx.score();
                this.phase = Phase.REMOVE_ANIM;
                this.renderer.startRemoveAnimation(toRemove);
                this.setMessage(`+${score} points!`);
                this.updateUI();
                return;
            }

            // Check game over
            if (isBoardFull(this.grid)) {
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
        const placed = spawnCells(this.grid, this.nextColors);
        this.nextColors = generateNextColors();
        this.updateUI();

        if (placed.length > 0) {
            this.phase = Phase.SPAWN_ANIM;
            this.renderer.startSpawnAnimation(placed);
        } else {
            // Board is full
            this.gameOver();
        }
    }

    private gameOver() {
        this.phase = Phase.GAME_OVER;
        this.sfx.gameOver();
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

new MicroCellsGame();
