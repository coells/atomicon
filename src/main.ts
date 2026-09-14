import { CHARACTER_NAMES } from "./characters";
import "./style.css";
import {
    ALL_VALID_POSITIONS,
    checkLines,
    countOccupied,
    createEmptyGrid,
    findPath,
    generateNextColors,
    getSpawnCount,
    hasAnyMove,
    JOKER_COLOR,
    PREVIEW_SIZE,
    removeMatches,
    spawnCells,
    VALID_CELL_COUNT,
    type CellColor,
    type Grid,
    type Position,
} from "./game";
import { Soundscape } from "./audio";
import { parsePreferences, parseScores, readStored, saveStored, type Preferences } from "./preferences";
import { FRAME_MS, Renderer } from "./renderer";

type Phase = "deal" | "select" | "move" | "remove" | "spawn" | "over";
const CREATURE_NAMES = CHARACTER_NAMES;

function element(id: string): HTMLElement {
    const value = document.getElementById(id);
    if (!value) throw new Error(`Missing interface element: ${id}`);
    return value;
}
function canvasElement(id: string): HTMLCanvasElement {
    const value = element(id);
    if (!(value instanceof HTMLCanvasElement)) throw new Error(`Expected canvas: ${id}`);
    return value;
}
function inputElement(id: string): HTMLInputElement {
    const value = element(id);
    if (!(value instanceof HTMLInputElement)) throw new Error(`Expected input: ${id}`);
    return value;
}

class AtomiconGame {
    private grid: Grid = createEmptyGrid();
    private canvas = canvasElement("game-canvas");
    private renderer = new Renderer(this.canvas);
    private sound = new Soundscape();
    private phase: Phase = "select";
    private selected: Position | null = null;
    private keyboardPos: Position = ALL_VALID_POSITIONS[0];
    private score = 0;
    private combo = 0;
    private moveCount = 0;
    private best = readStored("atomicon_best", (value) =>
        typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0,
    );
    private nextColors: CellColor[] = [];
    private pendingRemove: Set<number> | null = null;
    private lastFrame = 0;
    private lastPreview = "";
    private preferences: Preferences;
    private motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    private scoreEl = element("score");
    private bestEl = element("best");
    private messageEl = element("message");
    private nextDots = Array.from({ length: PREVIEW_SIZE }, (_, i) => canvasElement(`next${i}`));
    private frame: number | null = null;
    private restartConfirm = element("restart-confirm");

    constructor() {
        const legacyMode = readStored("atomicon_sound_mode", (value) => (typeof value === "number" ? value : 3));
        this.preferences = readStored("atomicon_preferences", (value) =>
            parsePreferences(value, this.motionQuery.matches, legacyMode),
        );
        this.applyPreferences();
        this.bindSettings();
        this.canvas.addEventListener("click", (event) => {
            const pos = this.renderer.getCellFromPixel(event.clientX, event.clientY);
            if (pos) this.choose(pos);
        });
        this.canvas.addEventListener("pointermove", (event) => {
            if (event.pointerType === "touch") return;
            this.preview(this.renderer.getCellFromPixel(event.clientX, event.clientY));
        });
        this.canvas.addEventListener("pointerleave", () => this.renderer.setHover(null));
        this.canvas.addEventListener("focus", () => this.preview(this.keyboardPos));
        this.canvas.addEventListener("blur", () => this.renderer.setHover(null));
        this.canvas.addEventListener("keydown", (event) => this.handleBoardKey(event));
        element("new-game-btn").addEventListener("click", () => {
            this.restartConfirm.hidden = !this.restartConfirm.hidden;
        });
        element("cancel-restart-btn").addEventListener("click", () => {
            this.restartConfirm.hidden = true;
            element("new-game-btn").focus();
        });
        element("confirm-restart-btn").addEventListener("click", () => this.newGame());
        element("play-again-btn").addEventListener("click", () => this.newGame());
        element("settings-toggle").addEventListener("click", () => {
            const panel = element("settings-panel");
            panel.hidden = !panel.hidden;
            element("settings-toggle").setAttribute("aria-expanded", String(!panel.hidden));
        });
        element("sound-toggle").addEventListener("click", () => {
            this.preferences.muted = !this.preferences.muted;
            this.applyPreferences(true);
        });
        // Touch pointerdown is not an activation event on iOS. Unlock at
        // tap completion, before the board's click handler plays an effect.
        // Keep mouse-down support and a click fallback for assistive input.
        const unlockAudio = () => {
            void this.sound.unlock();
        };
        document.addEventListener(
            "pointerdown",
            (event) => {
                if (event.pointerType === "mouse") unlockAudio();
            },
            { capture: true, passive: true },
        );
        for (const event of ["pointerup", "touchend", "click"] as const)
            document.addEventListener(event, unlockAudio, { capture: true, passive: true });
        document.addEventListener("keydown", (event) => {
            void this.sound.unlock();
            if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
            if (event.target instanceof HTMLInputElement) return;
            if (event.key.toLowerCase() === "m") {
                this.preferences.muted = !this.preferences.muted;
                this.applyPreferences(true);
            }
        });
        document.body.classList.toggle("page-hidden", document.hidden);
        document.addEventListener("visibilitychange", () => {
            document.body.classList.toggle("page-hidden", document.hidden);
            this.sound.handleVisibility();
            if (this.frame !== null) cancelAnimationFrame(this.frame);
            this.frame = null;
            if (!document.hidden) this.requestDraw();
        });
        this.motionQuery.addEventListener("change", () => {
            this.preferences.reducedMotion = this.motionQuery.matches;
            this.applyPreferences();
        });
        const resize = () => {
            if (!this.renderer.resize()) return;
            // Resizing clears a canvas. Paint in the same layout cycle so an
            // orientation change never presents a blank board.
            this.renderer.draw(this.grid);
            this.requestDraw();
        };
        const observer = new ResizeObserver(resize);
        observer.observe(element("board-wrap"));
        window.addEventListener("resize", resize);
        this.renderer.onAnimationComplete = () => this.onAnimComplete();
        this.renderer.onInvalidate = () => this.requestDraw();
        this.newGame();
    }

    private bindSettings() {
        for (const channel of ["music", "effects"] as const) {
            inputElement(`${channel}-volume`).addEventListener("input", (event) => {
                if (!(event.target instanceof HTMLInputElement)) return;
                this.preferences[channel] = Number(event.target.value) / 100;
                this.applyPreferences(true);
            });
        }
        inputElement("mute-audio").addEventListener("change", () => {
            this.preferences.muted = inputElement("mute-audio").checked;
            this.applyPreferences(true);
        });
        inputElement("reduce-motion").addEventListener("change", () => {
            this.preferences.reducedMotion = inputElement("reduce-motion").checked;
            this.applyPreferences(true);
        });
    }

    private applyPreferences(save = false) {
        this.sound.setPreferences(this.preferences);
        this.renderer.setReducedMotion(this.preferences.reducedMotion);
        document.body.classList.toggle("reduced-motion", this.preferences.reducedMotion);
        for (const channel of ["music", "effects"] as const) {
            const value = String(Math.round(this.preferences[channel] * 100));
            inputElement(`${channel}-volume`).value = value;
            element(`${channel}-value`).textContent = `${value}%`;
        }
        inputElement("mute-audio").checked = this.preferences.muted;
        inputElement("reduce-motion").checked = this.preferences.reducedMotion;
        const silent = this.preferences.muted || (this.preferences.music === 0 && this.preferences.effects === 0);
        element("sound-toggle").classList.toggle("muted", silent);
        element("sound-label").textContent = silent ? "Muted" : "Sound";
        element("sound-toggle").setAttribute("aria-label", silent ? "Unmute audio" : "Mute audio");
        element("sound-toggle").setAttribute("aria-pressed", String(silent));
        if (save) saveStored("atomicon_preferences", this.preferences);
    }

    private newGame() {
        this.renderer.reset();
        this.grid = createEmptyGrid();
        this.score = 0;
        this.combo = 0;
        this.moveCount = 0;
        this.selected = null;
        this.pendingRemove = null;
        this.phase = "select";
        element("game-end").hidden = true;
        this.restartConfirm.hidden = true;
        this.nextColors = generateNextColors(PREVIEW_SIZE, 0);
        const placed = spawnCells(this.grid, generateNextColors(6, 0));
        this.phase = "deal";
        this.renderer.startSpawnAnimation(placed);
        this.updateUI();
        this.setMessage("Choose a creature, then an empty space.");
    }

    private updateUI() {
        this.scoreEl.textContent = this.score.toLocaleString();
        this.bestEl.textContent = this.best.toLocaleString();
        const occupied = countOccupied(this.grid);
        const spawnCount = getSpawnCount(this.moveCount, occupied / VALID_CELL_COUNT);
        const previewKey = `${spawnCount}:${this.nextColors.join(",")}`;
        if (previewKey !== this.lastPreview) {
            this.nextDots.forEach((dot, i) => {
                dot.classList.toggle("hidden", i >= spawnCount);
                if (i >= spawnCount) return;
                const color = this.nextColors[i];
                this.renderer.drawPreview(dot, color);
                dot.setAttribute("role", "img");
                dot.setAttribute("aria-label", CREATURE_NAMES[color]);
                dot.title = CREATURE_NAMES[color];
            });
            this.lastPreview = previewKey;
        }
        element("arrival-count").textContent = `${spawnCount} creatures`;
        element("space-count").textContent = String(VALID_CELL_COUNT - occupied);
        element("turn-count").textContent = `MOVE ${String(this.moveCount + 1).padStart(2, "0")}`;
        element("space-fill").style.width = `${(occupied / VALID_CELL_COUNT) * 100}%`;
        element("space-meter").setAttribute("aria-valuenow", String(occupied));
        element("space-meter").classList.toggle("danger", occupied > 45);
    }

    private setMessage(message: string) {
        this.messageEl.textContent = message;
    }

    private preview(pos: Position | null) {
        if (this.phase !== "select") {
            this.renderer.setHover(null);
            return;
        }
        if (!pos || !this.selected || this.grid[pos.row][pos.col].color >= 0) {
            this.renderer.setHover(pos);
            return;
        }
        const path = findPath(this.grid, this.selected, pos);
        this.renderer.setHover(pos, path, !path);
    }

    private handleBoardKey(event: KeyboardEvent) {
        if (this.phase !== "select") return;
        if (event.key === "Escape") {
            this.selected = null;
            this.renderer.setSelected(null);
            this.setMessage("Choose a creature, then an empty space.");
        } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            this.choose(this.keyboardPos);
        } else if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
            event.preventDefault();
            this.keyboardPos = this.renderer.keyboardNeighbor(this.keyboardPos, event.key);
            this.preview(this.keyboardPos);
            const color = this.grid[this.keyboardPos.row][this.keyboardPos.col].color;
            this.setMessage(
                `${color >= 0 ? CREATURE_NAMES[color] : "Empty space"} · row ${this.keyboardPos.row + 1}, column ${this.keyboardPos.col + 1}. Enter to ${this.selected && color < 0 ? "move" : "select"}.`,
            );
        }
    }

    private choose(pos: Position) {
        if (this.phase !== "select") return;
        this.keyboardPos = pos;
        const color = this.grid[pos.row][pos.col].color;
        if (color >= 0) {
            if (this.selected?.row === pos.row && this.selected.col === pos.col) {
                this.selected = null;
                this.renderer.setSelected(null);
                this.setMessage("Choose a creature, then an empty space.");
                return;
            }
            this.selected = pos;
            this.renderer.setSelected(pos);
            this.sound.effect("select");
            this.setMessage(
                `${color === JOKER_COLOR ? "Wild friend" : CREATURE_NAMES[color]} selected. Choose an empty space.`,
            );
            return;
        }
        if (!this.selected) return;
        const path = findPath(this.grid, this.selected, pos);
        if (!path?.length) {
            this.sound.effect("blocked");
            this.renderer.setHover(pos, null, true);
            this.setMessage("That path is blocked. Try another space.");
            return;
        }
        this.phase = "move";
        const movingColor = this.grid[this.selected.row][this.selected.col].color;
        this.grid[this.selected.row][this.selected.col].color = -1;
        this.grid[pos.row][pos.col].color = movingColor;
        this.renderer.setSelected(null);
        this.renderer.startPathAnimation([this.selected, ...path], movingColor);
        this.sound.effect("move");
        this.selected = null;
        this.setMessage("Making a little connection…");
    }

    private handleClears(): boolean {
        const { toRemove, score } = checkLines(this.grid);
        if (!toRemove.size) {
            this.combo = 0;
            return false;
        }
        this.combo++;
        const turnScore = score + (this.combo > 1 ? Math.floor(score * 0.2 * (this.combo - 1)) : 0);
        this.score += turnScore;
        if (this.score > this.best) {
            this.best = this.score;
            saveStored("atomicon_best", this.best);
        }
        this.pendingRemove = toRemove;
        this.phase = "remove";
        this.renderer.startRemoveAnimation(toRemove);
        const tier = toRemove.size >= 8 ? 3 : toRemove.size >= 7 ? 2 : 1;
        this.renderer.startCelebration(toRemove, tier);
        this.sound.effect("clear", Math.max(this.combo, tier));
        this.setMessage(
            this.combo > 1
                ? `Lovely connections! ×${this.combo} combo · +${turnScore}`
                : `${toRemove.size} together. +${turnScore} points.`,
        );
        this.updateUI();
        return true;
    }

    private onAnimComplete() {
        switch (this.phase) {
            case "deal":
                // The opening animation must not score or consume a turn.
                this.enterSelect();
                break;
            case "move":
                this.moveCount++;
                if (!this.handleClears()) this.spawnPhase();
                break;
            case "remove":
                if (this.pendingRemove) removeMatches(this.grid, this.pendingRemove);
                this.pendingRemove = null;
                if (countOccupied(this.grid) === 0) this.spawnPhase();
                else this.enterSelect(true);
                break;
            case "spawn":
                if (this.handleClears()) return;
                if (hasAnyMove(this.grid)) this.enterSelect();
                else this.gameOver();
                break;
        }
    }

    private enterSelect(keepMessage = false) {
        this.phase = "select";
        if (!keepMessage) this.setMessage("Choose a creature, then an empty space.");
        this.updateUI();
    }

    private spawnPhase() {
        const count = getSpawnCount(this.moveCount, countOccupied(this.grid) / VALID_CELL_COUNT);
        const placed = spawnCells(this.grid, this.nextColors.slice(0, count));
        this.nextColors = generateNextColors(PREVIEW_SIZE, this.moveCount);
        if (!placed.length) {
            this.gameOver();
            return;
        }
        this.phase = "spawn";
        this.renderer.startSpawnAnimation(placed);
        this.sound.effect("spawn");
        this.setMessage(`${placed.length} new friends have arrived.`);
        this.updateUI();
    }

    private gameOver() {
        this.phase = "over";
        this.sound.effect("end");
        this.updateUI();
        const scores = readStored("atomicon_leaderboard", parseScores);
        scores.push(this.score);
        scores.sort((a, b) => b - a);
        saveStored("atomicon_leaderboard", scores.slice(0, 5));
        element("final-score").textContent = this.score.toLocaleString();
        const list = element("top-scores");
        list.textContent = "";
        let highlighted = false;
        for (const value of scores.slice(0, 5)) {
            const li = document.createElement("li");
            li.textContent = value.toLocaleString();
            if (!highlighted && value === this.score) {
                li.className = "current";
                highlighted = true;
            }
            list.append(li);
        }
        element("game-end").hidden = false;
        this.setMessage("Constellation complete.");
    }

    private requestDraw = () => {
        if (this.frame === null && !document.hidden) this.frame = requestAnimationFrame(this.loop);
    };

    private loop = (now: number) => {
        this.frame = null;
        if (document.hidden) return;
        // Cached sprites at 20 fps while resting, 30 fps during a move/clear.
        // Reduced-motion mode stops scheduling entirely when the board settles.
        const interval = this.renderer.isBusy() ? FRAME_MS * 2 : 1000 / 20;
        const elapsed = now - this.lastFrame;
        if (elapsed < interval) {
            this.requestDraw();
            return;
        }
        // Carry the remainder so display refresh timing cannot speed up the
        // target rate or round every frame down to a slower fixed cadence.
        this.lastFrame = now - (elapsed % interval);
        const wasBusy = this.renderer.isBusy();
        this.renderer.draw(this.grid, now);
        // Flush the final settled frame after an animation completes.
        if (wasBusy || this.renderer.isBusy() || (!this.preferences.reducedMotion && this.phase !== "over"))
            this.requestDraw();
    };
}

new AtomiconGame();
