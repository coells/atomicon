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

    move() {
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

    constructor() {
        const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
        this.renderer = new Renderer(canvas);
        this.grid = createEmptyGrid();

        this.scoreEl = document.getElementById("score")!;
        this.bestEl = document.getElementById("best")!;
        this.messageEl = document.getElementById("message")!;
        this.overlay = document.getElementById("overlay")!;
        this.finalScoreEl = document.getElementById("final-score")!;
        this.nextDots = [];
        for (let i = 0; i < PREVIEW_SIZE; i++) {
            const dot = document.getElementById(`next${i}`);
            if (dot) this.nextDots.push(dot);
        }
        this.difficultyEl = document.getElementById("difficulty")!;
        this.comboEl = document.getElementById("combo")!;

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
                    localStorage.setItem("microcells_best", String(this.best));
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
                    localStorage.setItem("microcells_best", String(this.best));
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
