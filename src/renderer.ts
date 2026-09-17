import { CharacterArt } from "./characters";
import { ConnectionEffect, ConnectionSprites } from "./connection-effect";
import {
    ALL_VALID_POSITIONS,
    cellIndex,
    GRID_SIZE,
    HEX_RADIUS,
    JOKER_COLOR,
    type CellColor,
    type Grid,
    type Position,
} from "./game";

interface CellTheme {
    core: string;
    glow: string;
    membrane: string;
    nucleus: string;
}

const SQRT3 = Math.sqrt(3);
const BOARD_PADDING = 3;
// Includes the largest silhouette, shadow, breathing and selection bounce.
// The complete animated character stays inside the hex well's apothem.
const CREATURE_SCALE = 0.6;

export const FRAME_MS = 1000 / 60;
const MAX_DPR = 2; // dpr 3 costs 2.25x the fill work of dpr 2 for no visible gain on a game board

const CELL_THEMES: CellTheme[] = [
    /* 0 Cat  – vivid red    */ {
        core: "#F36E7D",
        glow: "rgba(255,45,79,0.42)",
        membrane: "#FF6B83",
        nucleus: "#BF1030",
    },
    /* 1 Fish – deep blue    */ {
        core: "#60A5F5",
        glow: "rgba(30,128,255,0.42)",
        membrane: "#60A8FF",
        nucleus: "#0050CC",
    },
    /* 2 Frog – vivid green  */ {
        core: "#88CD72",
        glow: "rgba(45,216,85,0.42)",
        membrane: "#72E890",
        nucleus: "#14A832",
    },
    /* 3 Fox  – orange       */ {
        core: "#EDA653",
        glow: "rgba(255,140,0,0.42)",
        membrane: "#FFB347",
        nucleus: "#CC6600",
    },
    /* 4 Owl  – rich purple  */ {
        core: "#AD8DE8",
        glow: "rgba(155,48,255,0.42)",
        membrane: "#BE7DFF",
        nucleus: "#6B0FBF",
    },
    /* 5 Bunny– hot pink     */ {
        core: "#EF92C6",
        glow: "rgba(255,77,174,0.42)",
        membrane: "#FF8DC7",
        nucleus: "#D4287A",
    },
    /* 6 Sandstone golem */ {
        core: "#edcb8e",
        glow: "rgba(237,203,142,0.42)",
        membrane: "#ffe5b7",
        nucleus: "#93623b",
    },
];

const JOKER_THEME: CellTheme = {
    core: "#ffd86b",
    glow: "rgba(255,216,107,0.45)",
    membrane: "#ffe59e",
    nucleus: "#d6a72f",
};

export class Renderer {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private validPositions: Position[];
    /* cell centers indexed by row * GRID_SIZE + col — no string keys in the per-frame loop */
    private centers: ({ x: number; y: number } | null)[] = [];
    private hexRadius = 20;
    private boardSize = 0;
    private dpr = 1;

    /* time-based animation clock (frame-rate independent) */
    private timeT = 0; // advances T_RATE per second
    private lastNow: number | null = null;
    private dtF = 1; // delta time in 60fps-frame units

    /* cached rendering layers/sprites — size-dependent ones rebuilt on resize */
    private tileLayer: HTMLCanvasElement | null = null;
    private previewTargets = new Map<HTMLCanvasElement, CellColor>();
    private art = new CharacterArt(() => {
        for (const [canvas, color] of this.previewTargets) this.drawPreview(canvas, color);
        this.onInvalidate?.();
    });
    /* fixed 64px sprites — size-independent, never invalidated */
    private glowSpriteCache = new Map<string, HTMLCanvasElement>();
    private selectionHaloCache = new Map<string, HTMLCanvasElement>();
    private connectionSprites = new ConnectionSprites([...CELL_THEMES.map((theme) => theme.core), JOKER_THEME.core]);

    private reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    private hoverPos: Position | null = null;
    private previewPath: Position[] | null = null;
    private hoverBlocked = false;
    private selectedPos: Position | null = null;
    private selectionProgress = 1;
    private selectionGreeting = { tilt: 0, squash: 0 };
    private blockedFeedback: { pos: Position; progress: number } | null = null;
    private wiggleCycle = -1;
    private glintCycle = -1;
    private wiggleCell = -1;
    private glintCell = -1;
    private pathAnim: { path: Position[]; progress: number; elapsedMs: number; color: CellColor } | null = null;
    private spawnAnim: { keys: Set<number>; progress: number } | null = null;
    private removeAnim: ConnectionEffect | null = null;
    private clearAfterglow: ConnectionEffect | null = null;

    /** Trail particles emitted during path movement */
    private trailParticles: { x: number; y: number; vx: number; vy: number; life: number; color: string }[] = [];
    private trailEmitAccum = 0;

    onAnimationComplete: (() => void) | null = null;
    onInvalidate: (() => void) | null = null;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        // Transparent corners let the circular instrument sit in the scene.
        this.ctx = canvas.getContext("2d")!;
        this.validPositions = ALL_VALID_POSITIONS;
        this.resize();
    }

    private centerOf(pos: Position): { x: number; y: number } {
        return this.centers[cellIndex(pos)]!;
    }

    private axial(pos: Position): { q: number; r: number } {
        return { q: pos.col - HEX_RADIUS, r: pos.row - HEX_RADIUS };
    }

    private unitCenter(pos: Position): { x: number; y: number } {
        const { q, r } = this.axial(pos);
        return {
            x: SQRT3 * (q + r / 2),
            y: 1.5 * r,
        };
    }

    resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
        const maxSize = this.canvas.parentElement?.clientWidth || window.innerWidth;
        if (maxSize === this.boardSize && dpr === this.dpr) return;
        this.dpr = dpr;
        this.boardSize = maxSize;

        this.canvas.style.width = "100%";
        this.canvas.style.height = "100%";
        this.canvas.width = maxSize * dpr;
        this.canvas.height = maxSize * dpr;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const pos of this.validPositions) {
            const p = this.unitCenter(pos);
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
        }

        const available = maxSize - Math.min(BOARD_PADDING, maxSize * 0.068) * 2;
        this.hexRadius = Math.min(available / (maxX - minX + 2.2), available / (maxY - minY + 2.2));

        const boardCenterX = maxSize / 2;
        const boardCenterY = maxSize / 2;
        const unitMidX = (minX + maxX) / 2;
        const unitMidY = (minY + maxY) / 2;

        this.centers = new Array(GRID_SIZE * GRID_SIZE).fill(null);
        for (const pos of this.validPositions) {
            const u = this.unitCenter(pos);
            const x = boardCenterX + (u.x - unitMidX) * this.hexRadius;
            const y = boardCenterY + (u.y - unitMidY) * this.hexRadius;
            this.centers[cellIndex(pos)] = { x, y };
        }

        // Fixed-size glow sprites survive resizes; only the board layer changes.
        this.buildBoardLayers();
        return true;
    }

    /** Cache the hex wells in one layer; transparent corners reveal the CSS background. */
    private buildBoardLayers() {
        const px = Math.round(this.boardSize * this.dpr);
        if (!this.tileLayer) this.tileLayer = document.createElement("canvas");
        this.tileLayer.width = px;
        this.tileLayer.height = px;
        const tctx = this.tileLayer.getContext("2d")!;
        tctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

        for (const pos of this.validPositions) {
            const center = this.centerOf(pos);

            const r = this.hexRadius * 0.91;
            this.traceHex(tctx, center.x, center.y + 2, r);
            tctx.fillStyle = "#061b1dcc";
            tctx.fill();
            const well = tctx.createLinearGradient(center.x, center.y - r, center.x, center.y + r);
            well.addColorStop(0, "#182747");
            well.addColorStop(0.4, "#101e37");
            well.addColorStop(1, "#0b152a");
            this.traceHex(tctx, center.x, center.y, r);
            tctx.fillStyle = well;
            tctx.fill();
            tctx.strokeStyle = "#61cfd94d";
            tctx.lineWidth = 0.8;
            tctx.stroke();
            this.traceHex(tctx, center.x, center.y + 0.8, r * 0.85);
            tctx.strokeStyle = "#050f141f";
            tctx.lineWidth = 0.7;
            tctx.stroke();
            tctx.fillStyle = "#afc2a52b";
            tctx.beginPath();
            tctx.arc(center.x, center.y, 0.9, 0, Math.PI * 2);
            tctx.fill();
        }
    }

    getCellFromPixel(clientX: number, clientY: number): Position | null {
        // Scale from client space to board coordinate space (handles
        // pinch-to-zoom, CSS transforms, and DPR mismatches)
        const rect = this.canvas.getBoundingClientRect();
        let x = clientX - rect.left;
        let y = clientY - rect.top;
        if (rect.width > 0 && rect.height > 0) {
            x *= this.boardSize / rect.width;
            y *= this.boardSize / rect.height;
        }
        // Nearest-center lookup: cells are √3·R apart, so the closest center
        // within one hex radius is unambiguous (and allocation-free).
        let best: Position | null = null;
        let bestD = Infinity;
        for (const pos of this.validPositions) {
            const center = this.centerOf(pos);
            const dx = x - center.x;
            const dy = y - center.y;
            const d = dx * dx + dy * dy;
            if (d < bestD) {
                bestD = d;
                best = pos;
            }
        }
        const maxD = this.hexRadius * 0.96;
        return bestD <= maxD * maxD ? best : null;
    }

    keyboardNeighbor(from: Position, key: string): Position {
        const origin = this.centerOf(from);
        const horizontal = key === "ArrowLeft" || key === "ArrowRight";
        const sign = key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1;
        let best = from;
        let bestDistance = Infinity;
        for (const pos of this.validPositions) {
            const center = this.centerOf(pos);
            const dx = center.x - origin.x;
            const dy = center.y - origin.y;
            const forward = (horizontal ? dx : dy) * sign;
            const sideways = Math.abs(horizontal ? dy : dx);
            if (forward < 1 || sideways > forward * 1.2) continue;
            const distance = forward + sideways * 1.5;
            if (distance < bestDistance) {
                best = pos;
                bestDistance = distance;
            }
        }
        return best;
    }

    private traceHex(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number) {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const angle = ((60 * i - 30) * Math.PI) / 180;
            const x = cx + radius * Math.cos(angle);
            const y = cy + radius * Math.sin(angle);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
    }

    setSelected(pos: Position | null) {
        this.selectedPos = pos;
        this.blockedFeedback = null;
        this.selectionProgress = pos && !this.reducedMotion ? 0 : 1;
        if (this.selectionProgress === 0) {
            // Pick once per selection, not per frame. Both gestures use the existing
            // 320 ms pulse and return to the original pose without delaying input.
            const tilt = Math.random() < 0.5;
            const direction = Math.random() < 0.5 ? -1 : 1;
            const strength = 0.8 + Math.random() * 0.2;
            this.selectionGreeting.tilt = tilt ? direction * 0.12 * strength : 0;
            this.selectionGreeting.squash = tilt ? 0 : 0.075 * strength;
        }
        this.resetClock();
        this.setHover(null);
    }

    setHover(pos: Position | null, path: Position[] | null = null, blocked = false) {
        this.hoverPos = pos;
        this.previewPath = path;
        this.hoverBlocked = blocked;
        this.onInvalidate?.();
    }

    /** A rejected tap is decoration only: keep selection and input available. */
    showBlockedDestination(pos: Position) {
        this.resetClock();
        this.setHover(null);
        // Repeated taps replace the one effect rather than accumulating animations.
        this.blockedFeedback = { pos, progress: 0 };
        this.onInvalidate?.();
    }

    setReducedMotion(reduced: boolean) {
        this.reducedMotion = reduced;
        if (reduced) {
            this.clearAfterglow = null;
            this.selectionProgress = 1;
        }
        this.onInvalidate?.();
        this.trailParticles = [];
    }

    /** Exclude time spent idle or hidden from the next animation step. */
    resetClock() {
        this.lastNow = null;
    }

    reset() {
        this.resetClock();
        this.canvas.setAttribute("aria-busy", "false");
        this.pathAnim = null;
        this.spawnAnim = null;
        this.removeAnim = null;
        this.clearAfterglow = null;
        this.trailParticles = [];
        this.trailEmitAccum = 0;
        this.setSelected(null);
    }

    drawPreview(canvas: HTMLCanvasElement, color: CellColor) {
        const ctx = canvas.getContext("2d")!;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        this.previewTargets.set(canvas, color);
        this.art.draw(ctx, color, canvas.width / 2, canvas.height / 2, canvas.width);
    }

    startPathAnimation(path: Position[], color: CellColor) {
        this.blockedFeedback = null;
        this.resetClock();
        this.canvas.setAttribute("aria-busy", "true");
        this.pathAnim = { path, progress: 0, elapsedMs: 0, color };
        this.onInvalidate?.();
    }

    startSpawnAnimation(positions: Position[]) {
        this.resetClock();
        this.canvas.setAttribute("aria-busy", "true");
        this.spawnAnim = { keys: new Set(positions.map(cellIndex)), progress: 0 };
        this.onInvalidate?.();
    }

    startRemoveAnimation(positions: Set<number>, grid: Grid, origin?: Position) {
        this.resetClock();
        this.canvas.setAttribute("aria-busy", "true");
        this.removeAnim = new ConnectionEffect(positions, grid, origin);
        this.trailParticles = [];
        this.onInvalidate?.();
    }

    /** A discrete board animation (move/spawn/remove) is in progress. */
    private isAnimating(): boolean {
        return !!(this.pathAnim || this.spawnAnim || this.removeAnim);
    }

    /** True while any animation/effect needs a full frame rate. */
    isBusy(): boolean {
        return (
            this.isAnimating() ||
            this.selectionProgress < 1 ||
            this.blockedFeedback !== null ||
            this.clearAfterglow !== null ||
            this.trailParticles.length > 0
        );
    }

    private chooseIdleActors(grid: Grid) {
        const seconds = this.timeT / 2;
        const wiggle = Math.floor((seconds + 14) / 28);
        const glint = Math.floor((seconds + 22) / 41);
        if (wiggle === this.wiggleCycle && glint === this.glintCycle) return;
        const occupied = this.validPositions.filter((pos) => grid[pos.row][pos.col].color >= 0);
        if (wiggle !== this.wiggleCycle) {
            this.wiggleCell = occupied.length ? cellIndex(occupied[(wiggle * 11 + 3) % occupied.length]) : -1;
            this.wiggleCycle = wiggle;
        }
        if (glint !== this.glintCycle) {
            this.glintCell = occupied.length ? cellIndex(occupied[(glint * 7 + 1) % occupied.length]) : -1;
            this.glintCycle = glint;
        }
    }

    draw(grid: Grid, now = performance.now()) {
        // Clamp dt ≥ 0: rAF timestamps can trail performance.now() used by the
        // resize repaint, and a negative dt would invert the decay factors.
        const dtMs = this.lastNow === null ? FRAME_MS : Math.min(100, Math.max(0, now - this.lastNow));
        this.lastNow = now;
        this.dtF = dtMs / FRAME_MS;
        // Fixed creature poses avoid continuously growing the sprite cache.
        // Hover repaints must not be the clock for creature motion. Advance only
        // during bounded effects; no idle timer or perpetual animation loop.
        if (!this.reducedMotion && this.isBusy()) this.timeT += (dtMs / 1000) * 2;
        this.chooseIdleActors(grid);

        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.boardSize, this.boardSize);

        ctx.save();

        ctx.drawImage(this.tileLayer!, 0, 0, this.boardSize, this.boardSize);
        this.drawCenterEmblem();
        this.clearAfterglow?.drawGlow(ctx, this.centers, this.hexRadius, this.reducedMotion, this.connectionSprites);
        this.removeAnim?.drawGlow(ctx, this.centers, this.hexRadius, this.reducedMotion, this.connectionSprites);
        this.drawInteraction();
        this.drawBlockedFeedback();
        this.drawMoveFeedback();

        const pathDest = this.pathAnim ? this.pathAnim.path[this.pathAnim.path.length - 1] : null;

        for (const pos of this.validPositions) {
            const color = grid[pos.row][pos.col].color;
            if (color < 0) continue;

            const idx = cellIndex(pos);
            const center = this.centers[idx]!;
            const seed = idx;

            const clearing = this.removeAnim?.appearance(idx, this.reducedMotion);
            if (clearing) {
                ctx.save();
                ctx.translate(center.x, center.y - clearing.lift * this.hexRadius);
                ctx.scale(1 / clearing.stretch, clearing.stretch);
                this.drawMicroCell(0, 0, color, clearing.alpha, clearing.scale, false, seed);
                ctx.restore();
                continue;
            }

            if (pathDest && pathDest.row === pos.row && pathDest.col === pos.col) continue;

            if (this.spawnAnim && this.spawnAnim.keys.has(idx)) {
                this.drawMicroCell(
                    center.x,
                    center.y,
                    color,
                    this.spawnAnim.progress,
                    this.reducedMotion ? 1 : this.spawnAnim.progress,
                    false,
                    seed,
                );
                continue;
            }

            const selected = this.selectedPos?.row === pos.row && this.selectedPos?.col === pos.col;
            this.drawMicroCell(center.x, center.y, color, 1, 1, selected, seed);
        }

        if (this.pathAnim && this.pathAnim.path.length > 0) {
            const p = this.interpolatedPathPosition(
                this.pathAnim.path,
                this.reducedMotion ? 1 : this.pathAnim.progress,
            );
            if (!this.reducedMotion) this.emitTrailParticles(p.x, p.y, this.pathAnim.color);
            this.drawMicroCell(p.x, p.y, this.pathAnim.color, 1, 1, true, 0);
        }

        this.updateAndDrawTrailParticles();
        this.clearAfterglow?.draw(ctx, this.centers, this.hexRadius, this.reducedMotion, this.connectionSprites);
        this.removeAnim?.draw(ctx, this.centers, this.hexRadius, this.reducedMotion, this.connectionSprites);

        this.updateAnimations();
        ctx.restore();
    }

    private drawCenterEmblem() {
        const ctx = this.ctx;
        const mid = this.boardSize / 2;
        const r = this.hexRadius * 0.7;
        ctx.save();
        ctx.translate(mid, mid);
        const halo = this.getGlowSprite("#b9cda0");
        ctx.globalAlpha = 0.13 + (this.reducedMotion ? 0 : Math.sin(this.timeT * 0.45) * 0.035);
        ctx.drawImage(halo, -r * 2, -r * 2, r * 4, r * 4);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#c9b38177";
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.rotate(this.reducedMotion ? 0 : this.timeT * 0.035);
        for (let i = 0; i < 3; i++) {
            ctx.rotate(Math.PI / 3);
            ctx.beginPath();
            ctx.ellipse(0, 0, r * 0.36, r * 0.77, 0, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.fillStyle = "#e2d6a7";
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    private drawInteraction() {
        const ctx = this.ctx;
        const hoveredRejection =
            this.hoverPos && this.blockedFeedback && cellIndex(this.hoverPos) === cellIndex(this.blockedFeedback.pos);
        if (this.hoverPos && !this.isAnimating() && !hoveredRejection) {
            const p = this.centerOf(this.hoverPos);
            this.traceHex(ctx, p.x, p.y, this.hexRadius * 0.9);
            ctx.fillStyle = this.hoverBlocked ? "#ef96741a" : "#cce8b61c";
            ctx.strokeStyle = this.hoverBlocked ? "#ef9674aa" : "#cee3b695";
            ctx.lineWidth = 1.2;
            ctx.fill();
            ctx.stroke();
        }
        if (this.previewPath && this.selectedPos && !this.isAnimating()) {
            const start = this.centerOf(this.selectedPos);
            ctx.beginPath();
            ctx.moveTo(start.x, start.y);
            for (const pos of this.previewPath) {
                const p = this.centerOf(pos);
                ctx.lineTo(p.x, p.y);
            }
            ctx.setLineDash([3, 5]);
            ctx.lineDashOffset = this.reducedMotion ? 0 : -this.timeT * 5;
            ctx.strokeStyle = "#d9dcab99";
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }

    private drawBlockedFeedback() {
        const feedback = this.blockedFeedback;
        if (!feedback) return;
        const center = this.centerOf(feedback.pos);
        const radius = this.hexRadius * 0.9;
        const color = "#e8b86b";
        // Hold briefly, then fade smoothly. No displacement, expansion, or flashing,
        // so reduced motion can use the same small opacity-only acknowledgement.
        const fade = Math.max(0, Math.min(1, (feedback.progress - 0.18) / 0.82));
        const opacity = 1 - fade * fade * (3 - 2 * fade);
        const ctx = this.ctx;
        ctx.save();
        ctx.globalAlpha = opacity * 0.55;
        ctx.drawImage(this.getGlowSprite(color), center.x - radius, center.y - radius, radius * 2, radius * 2);
        this.traceHex(ctx, center.x, center.y, radius);
        ctx.fillStyle = color;
        ctx.globalAlpha = opacity * 0.12;
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.globalAlpha = opacity * 0.7;
        ctx.lineWidth = Math.max(1.2, this.hexRadius * 0.025);
        ctx.stroke();
        ctx.restore();
    }

    /** Render a soft radial glow (inner color fading to outer) into a 64px sprite. */
    private buildGlowSprite(inner: string, outer: string): HTMLCanvasElement {
        const size = 64;
        const c = document.createElement("canvas");
        c.width = size;
        c.height = size;
        const sctx = c.getContext("2d")!;
        const glow = sctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        glow.addColorStop(0, inner);
        glow.addColorStop(1, outer);
        sctx.fillStyle = glow;
        sctx.fillRect(0, 0, size, size);
        return c;
    }

    /** Cached radial glow sprite per particle color (theme cores, white, gold). */
    private getGlowSprite(color: string): HTMLCanvasElement {
        let sprite = this.glowSpriteCache.get(color);
        if (!sprite) {
            sprite = this.buildGlowSprite(color, color + "00");
            this.glowSpriteCache.set(color, sprite);
        }
        return sprite;
    }

    private interpolatedPathPosition(path: Position[], progress: number): { x: number; y: number } {
        if (path.length === 1) {
            return this.centerOf(path[0]);
        }
        const totalSegments = path.length - 1;
        const exact = progress * totalSegments;
        const idx = Math.min(Math.floor(exact), totalSegments - 1);
        const t = Math.max(0, Math.min(1, exact - idx));

        const a = this.centerOf(path[idx]);
        const b = this.centerOf(path[idx + 1]);
        return {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
        };
    }

    /** Tap-driven route and destination feedback, painted beneath the creatures.
     * Uses only the existing move frames; there is no separate timer or afterglow.
     */
    private drawMoveFeedback() {
        const animation = this.pathAnim;
        if (!animation?.path.length) return;
        const { path, progress, elapsedMs } = animation;
        const ctx = this.ctx;
        const start = this.centerOf(path[0]);
        const destination = this.centerOf(path[path.length - 1]);
        const color = "#dbe7bb";
        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = color;

        // Show the chosen route immediately, including on devices without hover.
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        for (let i = 1; i < path.length; i++) {
            const point = this.centerOf(path[i]);
            ctx.lineTo(point.x, point.y);
        }
        ctx.globalAlpha = 0.3;
        ctx.lineWidth = Math.max(1.1, this.hexRadius * 0.025);
        ctx.stroke();

        if (!this.reducedMotion && path.length > 1) {
            // The brighter part ends at the creature, not at the next hex center.
            const completed = Math.floor(progress * (path.length - 1));
            const head = this.interpolatedPathPosition(path, progress);
            ctx.beginPath();
            ctx.moveTo(start.x, start.y);
            for (let i = 1; i <= completed; i++) {
                const point = this.centerOf(path[i]);
                ctx.lineTo(point.x, point.y);
            }
            ctx.lineTo(head.x, head.y);
            ctx.globalAlpha = 0.12;
            ctx.lineWidth = Math.max(4, this.hexRadius * 0.16);
            ctx.stroke();
            ctx.globalAlpha = 0.55;
            ctx.lineWidth = Math.max(1.3, this.hexRadius * 0.035);
            ctx.stroke();
        }

        // One soft acknowledgement of the tap, then a steady target until arrival.
        // Reduced motion gets the steady marker with no expanding/pulsing geometry.
        const pulse = this.reducedMotion ? 0 : Math.max(0, 1 - elapsedMs / 320) ** 2;
        const glowRadius = this.hexRadius * 0.95;
        ctx.globalAlpha = 0.3 + pulse * 0.35;
        ctx.drawImage(
            this.getGlowSprite(color),
            destination.x - glowRadius,
            destination.y - glowRadius,
            glowRadius * 2,
            glowRadius * 2,
        );
        this.traceHex(ctx, destination.x, destination.y, this.hexRadius * 0.87);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.035 + pulse * 0.065;
        ctx.fill();
        ctx.globalAlpha = 0.35 + pulse * 0.35;
        ctx.lineWidth = Math.max(1, this.hexRadius * 0.02);
        ctx.stroke();
        ctx.restore();
    }

    /** A cached, soft-edged ring leaves the character itself unobscured. */
    private drawSelectionHalo(cx: number, cy: number, color: CellColor, alpha: number) {
        const theme = color === JOKER_COLOR ? JOKER_THEME : CELL_THEMES[color % CELL_THEMES.length];
        let sprite = this.selectionHaloCache.get(theme.core);
        if (!sprite) {
            sprite = document.createElement("canvas");
            sprite.width = sprite.height = 128;
            const ctx = sprite.getContext("2d")!;
            const ring = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
            ring.addColorStop(0, theme.core + "00");
            ring.addColorStop(0.64, theme.core + "00");
            ring.addColorStop(0.77, theme.core + "50");
            ring.addColorStop(0.84, theme.core + "b8");
            ring.addColorStop(0.91, theme.core + "45");
            ring.addColorStop(1, theme.core + "00");
            ctx.fillStyle = ring;
            ctx.fillRect(0, 0, 128, 128);
            this.selectionHaloCache.set(theme.core, sprite);
        }
        const pulse =
            !this.reducedMotion && this.selectedPos && this.selectionProgress < 1
                ? Math.sin(this.selectionProgress * Math.PI)
                : 0;
        const radius = this.hexRadius * 0.9;
        this.ctx.save();
        this.ctx.globalAlpha = alpha * (0.85 + pulse * 0.15);
        this.ctx.drawImage(sprite, cx - radius, cy - radius, radius * 2, radius * 2);
        this.ctx.restore();
    }

    /** Emit sparkle particles at the moving cell's current position (~1.5/frame at 60fps) */
    private emitTrailParticles(cx: number, cy: number, color: CellColor) {
        const theme = color === JOKER_COLOR ? JOKER_THEME : CELL_THEMES[color % CELL_THEMES.length];
        this.trailEmitAccum += 1.5 * this.dtF;
        const count = Math.floor(this.trailEmitAccum);
        this.trailEmitAccum -= count;
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 0.3 + Math.random() * 0.8;
            this.trailParticles.push({
                x: cx + (Math.random() - 0.5) * 4,
                y: cy + (Math.random() - 0.5) * 4,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 1.0,
                color: Math.random() > 0.4 ? theme.core : theme.membrane,
            });
        }
    }

    /** Update and render trail sparkle particles */
    private updateAndDrawTrailParticles() {
        const ctx = this.ctx;
        const decay = 0.025 * this.dtF;
        const friction = 0.96 ** this.dtF;
        for (let i = this.trailParticles.length - 1; i >= 0; i--) {
            const p = this.trailParticles[i];
            p.x += p.vx * this.dtF;
            p.y += p.vy * this.dtF;
            p.vx *= friction;
            p.vy *= friction;
            p.life -= decay;
            if (p.life <= 0) {
                this.trailParticles.splice(i, 1);
                continue;
            }

            const r = 1.5 + p.life * 2.5;
            const alpha = p.life * 0.7;

            // Soft glow (cached sprite instead of per-particle gradient)
            const glowR = r * 2.5;
            ctx.globalAlpha = alpha;
            ctx.drawImage(this.getGlowSprite(p.color), p.x - glowR, p.y - glowR, glowR * 2, glowR * 2);

            // Bright core
            ctx.globalAlpha = alpha * 0.8;
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.arc(p.x, p.y, r * 0.5, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    private updateAnimations() {
        let finished = false;
        // Selection feedback is visual only: never lock input or complete a game phase.
        this.selectionProgress = Math.min(1, this.selectionProgress + (this.dtF * FRAME_MS) / 320);

        if (this.blockedFeedback) {
            this.blockedFeedback.progress += (this.dtF * FRAME_MS) / 420;
            if (this.blockedFeedback.progress >= 1) {
                // A mouse preview during the fade must not leave this hex amber.
                if (this.hoverPos && cellIndex(this.hoverPos) === cellIndex(this.blockedFeedback.pos))
                    this.setHover(null);
                this.blockedFeedback = null;
            }
        }

        if (this.clearAfterglow) {
            this.clearAfterglow.advance(this.dtF * FRAME_MS);
            if (this.clearAfterglow.finished) this.clearAfterglow = null;
        }

        if (this.pathAnim) {
            this.pathAnim.elapsedMs += this.dtF * FRAME_MS;
            const segments = Math.max(1, this.pathAnim.path.length - 1);
            // Slower movement: ~60% of original speed
            this.pathAnim.progress += Math.min(0.065, 0.4 / segments) * this.dtF;
            if (this.pathAnim.progress >= 1) {
                this.pathAnim = null;
                finished = true;
            }
        }

        if (this.spawnAnim) {
            this.spawnAnim.progress += 0.075 * this.dtF;
            if (this.spawnAnim.progress >= 1) {
                this.spawnAnim = null;
                finished = true;
            }
        }

        if (this.removeAnim?.advance(this.dtF * FRAME_MS)) {
            // Keep only the latest tail, bounded even during successive clears.
            this.clearAfterglow = this.reducedMotion ? null : this.removeAnim;
            this.removeAnim = null;
            finished = true;
        }

        if (finished && !this.isAnimating()) {
            this.canvas.setAttribute("aria-busy", "false");
            this.onAnimationComplete?.();
        }
    }

    private drawMicroCell(
        cx: number,
        cy: number,
        color: CellColor,
        alpha: number,
        scale: number,
        selected = false,
        phaseSeed = 0,
    ) {
        const ctx = this.ctx;
        const radius = this.hexRadius * CREATURE_SCALE * scale;

        const bob = this.reducedMotion ? 0 : Math.sin(this.timeT + (cx + cy) * 0.01) * radius * 0.012;
        cy += bob;

        if (selected) this.drawSelectionHalo(cx, cy, color, alpha);
        ctx.globalAlpha = alpha;

        // The atlas has a 110px safe radius in each 256px tile. Including
        // breathing, bounce and bob, the artwork stays inside the hex well.
        const size = this.hexRadius * 1.64 * scale;
        ctx.save();
        ctx.translate(cx, cy);
        if (selected && this.selectedPos && !this.pathAnim && !this.reducedMotion && this.selectionProgress < 1) {
            // Transform only the sprite; its selection halo stays still. Squared
            // sine eases both endpoints, so the final pose settles without a snap.
            const envelope = Math.sin(this.selectionProgress * Math.PI) ** 2;
            ctx.rotate(this.selectionGreeting.tilt * envelope);
            const squash = this.selectionGreeting.squash * Math.sin(this.selectionProgress * Math.PI * 2) * envelope;
            ctx.scale(1 + squash, 1 - squash);
        }
        const personalTime = this.timeT + phaseSeed * 1.37;
        if (!this.reducedMotion && !this.isBusy() && phaseSeed === this.wiggleCell) {
            // One character gets a small greeting every 28 seconds.
            // There is no continuous rotation or whole-board dance.
            const age = (this.timeT / 2 + 14) % 28;
            if (age < 1.2) ctx.rotate(Math.sin((age / 1.2) * Math.PI) * Math.sin(age * Math.PI * 4) * 0.07);
        }
        const breathe = this.reducedMotion ? 0 : Math.sin(personalTime + color * 0.8) * 0.012;
        ctx.scale(1 + breathe, 1 - breathe);
        this.art.draw(ctx, color, 0, 0, size);
        if (!this.reducedMotion && !this.isBusy() && phaseSeed === this.glintCell) {
            const age = (this.timeT / 2 + 22) % 41;
            if (age < 0.85) {
                ctx.globalAlpha *= Math.sin((age / 0.85) * Math.PI) * 0.5;
                ctx.strokeStyle = "#fff9df";
                ctx.lineWidth = 0.65;
                const x = -radius * 0.12,
                    y = -radius * 0.22,
                    ray = radius * 0.13;
                ctx.beginPath();
                ctx.moveTo(x - ray, y);
                ctx.lineTo(x + ray, y);
                ctx.moveTo(x, y - ray);
                ctx.lineTo(x, y + ray);
                ctx.stroke();
            }
        }
        ctx.restore();

        ctx.globalAlpha = 1;
    }
}
