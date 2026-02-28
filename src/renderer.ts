import { GRID_SIZE, type CellColor, type Grid, type Position } from "./game";

// ─── Color palette (biological / neon vibes) ────────────────────────────────

interface CellTheme {
    core: string;
    glow: string;
    membrane: string;
    nucleus: string;
}

const CELL_THEMES: CellTheme[] = [
    { core: "#ff6b8a", glow: "rgba(255,107,138,0.35)", membrane: "#ff8da6", nucleus: "#cc3a5c" }, // red
    { core: "#6be0ff", glow: "rgba(107,224,255,0.35)", membrane: "#8de8ff", nucleus: "#2ab0d4" }, // cyan
    { core: "#7fefce", glow: "rgba(127,239,206,0.35)", membrane: "#a0f5dc", nucleus: "#3cc49e" }, // green
    { core: "#ffbe5c", glow: "rgba(255,190,92,0.35)", membrane: "#ffce80", nucleus: "#d4912a" }, // orange
    { core: "#c785ff", glow: "rgba(199,133,255,0.35)", membrane: "#d6a3ff", nucleus: "#9640e0" }, // purple
    { core: "#ff85c0", glow: "rgba(255,133,192,0.35)", membrane: "#ffa3d0", nucleus: "#d44a90" }, // pink
    { core: "#85c0ff", glow: "rgba(133,192,255,0.35)", membrane: "#a3d0ff", nucleus: "#4a7fc4" }, // blue
];

// ─── Render constants ────────────────────────────────────────────────────────

const BOARD_PADDING = 16;
const CELL_GAP = 3;

export class Renderer {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private cellSize = 0;
    private boardOffset = 0;
    private animFrame = 0;

    // Animations
    private selectedPos: Position | null = null;
    private selectedBounce = 0;
    private pathAnim: { path: Position[]; progress: number; color: CellColor } | null = null;
    private spawnAnim: { positions: Position[]; progress: number } | null = null;
    private removeAnim: { positions: Set<string>; progress: number } | null = null;

    // Callbacks
    onAnimationComplete: (() => void) | null = null;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d")!;
        this.resize();
    }

    resize() {
        const dpr = window.devicePixelRatio || 1;
        const maxSize = Math.min(window.innerWidth - 40, window.innerHeight - 200, 600);
        this.canvas.style.width = `${maxSize}px`;
        this.canvas.style.height = `${maxSize}px`;
        this.canvas.width = maxSize * dpr;
        this.canvas.height = maxSize * dpr;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const boardArea = maxSize - BOARD_PADDING * 2;
        this.cellSize = (boardArea - CELL_GAP * (GRID_SIZE - 1)) / GRID_SIZE;
        this.boardOffset = BOARD_PADDING;
    }

    getCellFromPixel(x: number, y: number): Position | null {
        const localX = x - this.boardOffset;
        const localY = y - this.boardOffset;
        const step = this.cellSize + CELL_GAP;
        const col = Math.floor(localX / step);
        const row = Math.floor(localY / step);
        if (row < 0 || row >= GRID_SIZE || col < 0 || col >= GRID_SIZE) return null;
        // Check we're inside the cell, not the gap
        if (localX - col * step > this.cellSize) return null;
        if (localY - row * step > this.cellSize) return null;
        return { row, col };
    }

    setSelected(pos: Position | null) {
        this.selectedPos = pos;
        this.selectedBounce = 0;
    }

    startPathAnimation(path: Position[], color: CellColor) {
        this.pathAnim = { path, progress: 0, color };
    }

    startSpawnAnimation(positions: Position[]) {
        this.spawnAnim = { positions, progress: 0 };
    }

    startRemoveAnimation(positions: Set<string>) {
        this.removeAnim = { positions, progress: 0 };
    }

    isAnimating(): boolean {
        return this.pathAnim !== null || this.spawnAnim !== null || this.removeAnim !== null;
    }

    // ─── Main draw loop ─────────────────────────────────────────────────────

    draw(grid: Grid) {
        this.animFrame++;
        const ctx = this.ctx;
        const size = parseFloat(this.canvas.style.width);

        // Clear
        ctx.clearRect(0, 0, size, size);

        // Board background
        ctx.fillStyle = "#111828";
        ctx.beginPath();
        ctx.roundRect(4, 4, size - 8, size - 8, 10);
        ctx.fill();

        // Draw cells
        const step = this.cellSize + CELL_GAP;
        for (let r = 0; r < GRID_SIZE; r++) {
            for (let c = 0; c < GRID_SIZE; c++) {
                const x = this.boardOffset + c * step;
                const y = this.boardOffset + r * step;
                const s = this.cellSize;

                // Cell background (petri dish well)
                ctx.fillStyle = "#0d1320";
                ctx.beginPath();
                ctx.roundRect(x, y, s, s, 4);
                ctx.fill();

                // Subtle border
                ctx.strokeStyle = "rgba(255,255,255,0.04)";
                ctx.lineWidth = 0.5;
                ctx.stroke();

                const key = `${r},${c}`;
                const color = grid[r][c].color;

                // Skip drawing cell in remove animation (fading)
                if (this.removeAnim && this.removeAnim.positions.has(key)) {
                    const alpha = 1 - this.removeAnim.progress;
                    if (color >= 0) {
                        this.drawMicroCell(x, y, s, color, alpha, 1 + this.removeAnim.progress * 0.3);
                    }
                    continue;
                }

                // Skip drawing target during path animation (cell is moving)
                if (this.pathAnim) {
                    // Don't draw the path endpoint's cell yet
                    const last = this.pathAnim.path[this.pathAnim.path.length - 1];
                    if (last && r === last.row && c === last.col) continue;
                }

                // Spawn animation
                if (this.spawnAnim && this.spawnAnim.positions.some((p) => p.row === r && p.col === c)) {
                    if (color >= 0) {
                        const scale = this.spawnAnim.progress;
                        this.drawMicroCell(x, y, s, color, this.spawnAnim.progress, scale);
                    }
                    continue;
                }

                // Normal cell
                if (color >= 0) {
                    const isSelected = this.selectedPos?.row === r && this.selectedPos?.col === c;
                    const bounce = isSelected ? Math.sin(this.selectedBounce) * 0.08 : 0;
                    this.drawMicroCell(x, y, s, color, 1, 1 + bounce, isSelected);
                }
            }
        }

        // Draw moving cell on path
        if (this.pathAnim) {
            const { path, progress, color } = this.pathAnim;
            if (path.length > 0) {
                const totalSteps = path.length;
                const exactStep = progress * totalSteps;
                const stepIdx = Math.min(Math.floor(exactStep), totalSteps - 1);
                const stepFrac = exactStep - stepIdx;

                let currentPos: Position;
                if (stepIdx < totalSteps - 1) {
                    const cur = path[stepIdx];
                    const next = path[stepIdx + 1];
                    currentPos = {
                        row: cur.row + (next.row - cur.row) * stepFrac,
                        col: cur.col + (next.col - cur.col) * stepFrac,
                    };
                } else {
                    currentPos = path[totalSteps - 1];
                }

                const x = this.boardOffset + currentPos.col * step;
                const y = this.boardOffset + currentPos.row * step;
                this.drawMicroCell(x, y, this.cellSize, color, 1, 1, true);
            }
        }

        // Update animations
        this.updateAnimations();
        this.selectedBounce += 0.12;
    }

    private updateAnimations() {
        let animDone = false;

        if (this.pathAnim) {
            const speed = Math.min(0.08, 0.5 / this.pathAnim.path.length);
            this.pathAnim.progress += speed;
            if (this.pathAnim.progress >= 1) {
                this.pathAnim = null;
                animDone = true;
            }
        }

        if (this.spawnAnim) {
            this.spawnAnim.progress += 0.06;
            if (this.spawnAnim.progress >= 1) {
                this.spawnAnim = null;
                animDone = true;
            }
        }

        if (this.removeAnim) {
            this.removeAnim.progress += 0.05;
            if (this.removeAnim.progress >= 1) {
                this.removeAnim = null;
                animDone = true;
            }
        }

        if (animDone && !this.isAnimating() && this.onAnimationComplete) {
            this.onAnimationComplete();
        }
    }

    // ─── Draw a single micro-organism cell ───────────────────────────────────

    private drawMicroCell(
        x: number,
        y: number,
        size: number,
        colorIdx: CellColor,
        alpha: number,
        scale: number,
        selected = false,
    ) {
        const ctx = this.ctx;
        const theme = CELL_THEMES[colorIdx % CELL_THEMES.length];

        const cx = x + size / 2;
        const cy = y + size / 2;
        const baseR = size * 0.4;
        const r = baseR * scale;

        ctx.save();
        ctx.globalAlpha = alpha;

        // Outer glow
        const glowR = r * 1.6;
        const glowGrad = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, glowR);
        glowGrad.addColorStop(0, theme.glow);
        glowGrad.addColorStop(1, "transparent");
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
        ctx.fill();

        // Selection ring
        if (selected) {
            ctx.strokeStyle = theme.core;
            ctx.lineWidth = 2;
            ctx.shadowColor = theme.core;
            ctx.shadowBlur = 12;
            ctx.beginPath();
            ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
            ctx.stroke();
            ctx.shadowBlur = 0;
        }

        // Membrane (outer circle)
        const memGrad = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.2, r * 0.1, cx, cy, r);
        memGrad.addColorStop(0, theme.membrane);
        memGrad.addColorStop(0.7, theme.core);
        memGrad.addColorStop(1, theme.nucleus);
        ctx.fillStyle = memGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();

        // Inner organelles — small circles for texture
        ctx.globalAlpha = alpha * 0.3;
        const time = this.animFrame * 0.02;
        for (let i = 0; i < 3; i++) {
            const angle = time + (i * Math.PI * 2) / 3;
            const dist = r * 0.35;
            const ox = cx + Math.cos(angle) * dist;
            const oy = cy + Math.sin(angle) * dist;
            const oR = r * 0.15;
            ctx.fillStyle = theme.nucleus;
            ctx.beginPath();
            ctx.arc(ox, oy, oR, 0, Math.PI * 2);
            ctx.fill();
        }

        // Nucleus
        ctx.globalAlpha = alpha * 0.9;
        const nucGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.3);
        nucGrad.addColorStop(0, "rgba(255,255,255,0.5)");
        nucGrad.addColorStop(1, "transparent");
        ctx.fillStyle = nucGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.3, 0, Math.PI * 2);
        ctx.fill();

        // Specular highlight
        ctx.globalAlpha = alpha * 0.6;
        const specX = cx - r * 0.25;
        const specY = cy - r * 0.25;
        const specGrad = ctx.createRadialGradient(specX, specY, 0, specX, specY, r * 0.4);
        specGrad.addColorStop(0, "rgba(255,255,255,0.7)");
        specGrad.addColorStop(1, "transparent");
        ctx.fillStyle = specGrad;
        ctx.beginPath();
        ctx.arc(specX, specY, r * 0.4, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    // ─── Utility ─────────────────────────────────────────────────────────────

    getThemeColor(colorIdx: CellColor): string {
        return CELL_THEMES[colorIdx % CELL_THEMES.length].core;
    }

    getCanvas(): HTMLCanvasElement {
        return this.canvas;
    }
}
