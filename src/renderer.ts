import {
    EMPTY_COLOR,
    getAllValidPositions,
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
const BOARD_PADDING = 30;

const CELL_THEMES: CellTheme[] = [
    { core: "#ff6b8a", glow: "rgba(255,107,138,0.38)", membrane: "#ff96ad", nucleus: "#cc3a5c" },
    { core: "#6be0ff", glow: "rgba(107,224,255,0.38)", membrane: "#91ebff", nucleus: "#2ab0d4" },
    { core: "#7fefce", glow: "rgba(127,239,206,0.38)", membrane: "#a9f7df", nucleus: "#38bf98" },
    { core: "#ffbe5c", glow: "rgba(255,190,92,0.38)", membrane: "#ffd38b", nucleus: "#d18f30" },
    { core: "#c785ff", glow: "rgba(199,133,255,0.38)", membrane: "#dcb0ff", nucleus: "#9640e0" },
    { core: "#ff85c0", glow: "rgba(255,133,192,0.38)", membrane: "#ffb2d9", nucleus: "#d44a90" },
    { core: "#85c0ff", glow: "rgba(133,192,255,0.38)", membrane: "#aed8ff", nucleus: "#4a7fc4" },
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
    private centers = new Map<string, { x: number; y: number }>();
    private hexRadius = 20;
    private boardSize = 0;
    private animFrame = 0;

    private selectedPos: Position | null = null;
    private selectedBounce = 0;
    private pathAnim: { path: Position[]; progress: number; color: CellColor } | null = null;
    private spawnAnim: { positions: Position[]; progress: number } | null = null;
    private removeAnim: { positions: Set<string>; progress: number } | null = null;

    onAnimationComplete: (() => void) | null = null;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d")!;
        this.validPositions = getAllValidPositions();
        this.resize();
    }

    private posKey(pos: Position): string {
        return `${pos.row},${pos.col}`;
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
        const dpr = window.devicePixelRatio || 1;
        const maxSize = Math.min(window.innerWidth - 32, window.innerHeight - 190, 760);
        this.boardSize = maxSize;

        this.canvas.style.width = `${maxSize}px`;
        this.canvas.style.height = `${maxSize}px`;
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

        const available = maxSize - BOARD_PADDING * 2;
        this.hexRadius = Math.min(available / (maxX - minX + 2.2), available / (maxY - minY + 2.2));

        const boardCenterX = maxSize / 2;
        const boardCenterY = maxSize / 2;
        const unitMidX = (minX + maxX) / 2;
        const unitMidY = (minY + maxY) / 2;

        this.centers.clear();
        for (const pos of this.validPositions) {
            const u = this.unitCenter(pos);
            const x = boardCenterX + (u.x - unitMidX) * this.hexRadius;
            const y = boardCenterY + (u.y - unitMidY) * this.hexRadius;
            this.centers.set(this.posKey(pos), { x, y });
        }
    }

    getCellFromPixel(x: number, y: number): Position | null {
        for (const pos of this.validPositions) {
            const center = this.centers.get(this.posKey(pos));
            if (!center) continue;
            if (this.pointInHex(x, y, center.x, center.y, this.hexRadius * 0.96)) {
                return pos;
            }
        }
        return null;
    }

    private pointInHex(px: number, py: number, cx: number, cy: number, radius: number): boolean {
        const points = this.hexPoints(cx, cy, radius);
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            const xi = points[i].x;
            const yi = points[i].y;
            const xj = points[j].x;
            const yj = points[j].y;
            const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
            if (intersect) inside = !inside;
        }
        return inside;
    }

    private hexPoints(cx: number, cy: number, radius: number): Array<{ x: number; y: number }> {
        const pts: Array<{ x: number; y: number }> = [];
        for (let i = 0; i < 6; i++) {
            const angle = ((60 * i - 30) * Math.PI) / 180;
            pts.push({
                x: cx + radius * Math.cos(angle),
                y: cy + radius * Math.sin(angle),
            });
        }
        return pts;
    }

    private drawHex(cx: number, cy: number, radius: number) {
        const pts = this.hexPoints(cx, cy, radius);
        this.ctx.beginPath();
        this.ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
            this.ctx.lineTo(pts[i].x, pts[i].y);
        }
        this.ctx.closePath();
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
        return !!(this.pathAnim || this.spawnAnim || this.removeAnim);
    }

    draw(grid: Grid) {
        this.animFrame++;
        const ctx = this.ctx;

        const bg = ctx.createRadialGradient(
            this.boardSize * 0.5,
            this.boardSize * 0.45,
            20,
            this.boardSize * 0.5,
            this.boardSize * 0.5,
            this.boardSize * 0.7,
        );
        bg.addColorStop(0, "#132235");
        bg.addColorStop(0.65, "#0f1728");
        bg.addColorStop(1, "#090d18");
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, this.boardSize, this.boardSize);

        const wave = Math.sin(this.animFrame * 0.015) * 0.05 + 1;
        for (const pos of this.validPositions) {
            const center = this.centers.get(this.posKey(pos));
            if (!center) continue;

            this.drawHex(center.x, center.y, this.hexRadius * 0.92);
            ctx.fillStyle = "rgba(13, 24, 41, 0.86)";
            ctx.fill();
            ctx.strokeStyle = "rgba(145, 176, 220, 0.09)";
            ctx.lineWidth = 1;
            ctx.stroke();

            this.drawHex(center.x, center.y, this.hexRadius * 0.5 * wave);
            ctx.strokeStyle = "rgba(95, 130, 180, 0.06)";
            ctx.lineWidth = 0.7;
            ctx.stroke();

            const color = grid[pos.row][pos.col].color;
            if (color === EMPTY_COLOR) continue;

            const key = this.posKey(pos);
            if (this.removeAnim && this.removeAnim.positions.has(key)) {
                this.drawMicroCell(
                    center.x,
                    center.y,
                    color,
                    1 - this.removeAnim.progress,
                    1 + this.removeAnim.progress * 0.4,
                );
                continue;
            }

            if (this.pathAnim) {
                const last = this.pathAnim.path[this.pathAnim.path.length - 1];
                if (last && last.row === pos.row && last.col === pos.col) continue;
            }

            if (this.spawnAnim && this.spawnAnim.positions.some((p) => p.row === pos.row && p.col === pos.col)) {
                this.drawMicroCell(center.x, center.y, color, this.spawnAnim.progress, this.spawnAnim.progress);
                continue;
            }

            const selected = this.selectedPos?.row === pos.row && this.selectedPos?.col === pos.col;
            const pulse = selected ? Math.sin(this.selectedBounce) * 0.08 : 0;
            this.drawMicroCell(center.x, center.y, color, 1, 1 + pulse, selected);
        }

        if (this.pathAnim && this.pathAnim.path.length > 0) {
            const p = this.interpolatedPathPosition(this.pathAnim.path, this.pathAnim.progress);
            this.drawMicroCell(p.x, p.y, this.pathAnim.color, 1, 1, true);
            this.drawPathTrail(this.pathAnim.path, this.pathAnim.progress);
        }

        this.updateAnimations();
        this.selectedBounce += 0.14;
    }

    private interpolatedPathPosition(path: Position[], progress: number): { x: number; y: number } {
        if (path.length === 1) {
            return this.centers.get(this.posKey(path[0]))!;
        }
        const totalSegments = path.length - 1;
        const exact = progress * totalSegments;
        const idx = Math.min(Math.floor(exact), totalSegments - 1);
        const t = Math.max(0, Math.min(1, exact - idx));

        const a = this.centers.get(this.posKey(path[idx]))!;
        const b = this.centers.get(this.posKey(path[idx + 1]))!;
        return {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
        };
    }

    private drawPathTrail(path: Position[], progress: number) {
        if (path.length < 2) return;
        const ctx = this.ctx;
        const totalSegments = path.length - 1;
        const exact = progress * totalSegments;
        const limit = Math.max(1, Math.ceil(exact));

        ctx.beginPath();
        const start = this.centers.get(this.posKey(path[0]))!;
        ctx.moveTo(start.x, start.y);
        for (let i = 1; i <= limit && i < path.length; i++) {
            const p = this.centers.get(this.posKey(path[i]))!;
            ctx.lineTo(p.x, p.y);
        }
        ctx.strokeStyle = "rgba(145, 220, 255, 0.35)";
        ctx.lineWidth = 2.2;
        ctx.shadowBlur = 12;
        ctx.shadowColor = "rgba(145, 220, 255, 0.6)";
        ctx.stroke();
        ctx.shadowBlur = 0;
    }

    private updateAnimations() {
        let finished = false;

        if (this.pathAnim) {
            const segments = Math.max(1, this.pathAnim.path.length - 1);
            this.pathAnim.progress += Math.min(0.11, 0.68 / segments);
            if (this.pathAnim.progress >= 1) {
                this.pathAnim = null;
                finished = true;
            }
        }

        if (this.spawnAnim) {
            this.spawnAnim.progress += 0.075;
            if (this.spawnAnim.progress >= 1) {
                this.spawnAnim = null;
                finished = true;
            }
        }

        if (this.removeAnim) {
            this.removeAnim.progress += 0.068;
            if (this.removeAnim.progress >= 1) {
                this.removeAnim = null;
                finished = true;
            }
        }

        if (finished && !this.isAnimating() && this.onAnimationComplete) {
            this.onAnimationComplete();
        }
    }

    private drawMicroCell(cx: number, cy: number, color: CellColor, alpha: number, scale: number, selected = false) {
        const ctx = this.ctx;
        const radius = this.hexRadius * 0.52 * scale;
        const theme = color === JOKER_COLOR ? JOKER_THEME : CELL_THEMES[color % CELL_THEMES.length];

        ctx.save();
        ctx.globalAlpha = alpha;

        const glow = ctx.createRadialGradient(cx, cy, radius * 0.25, cx, cy, radius * 1.8);
        glow.addColorStop(0, theme.glow);
        glow.addColorStop(1, "transparent");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 1.8, 0, Math.PI * 2);
        ctx.fill();

        if (selected) {
            ctx.strokeStyle = theme.core;
            ctx.lineWidth = 2;
            ctx.shadowColor = theme.core;
            ctx.shadowBlur = 14;
            ctx.beginPath();
            ctx.arc(cx, cy, radius + 5, 0, Math.PI * 2);
            ctx.stroke();
            ctx.shadowBlur = 0;
        }

        const membrane = ctx.createRadialGradient(cx - radius * 0.25, cy - radius * 0.25, radius * 0.2, cx, cy, radius);
        membrane.addColorStop(0, theme.membrane);
        membrane.addColorStop(0.72, theme.core);
        membrane.addColorStop(1, theme.nucleus);
        ctx.fillStyle = membrane;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();

        const t = this.animFrame * 0.022;
        ctx.globalAlpha = alpha * 0.35;
        for (let i = 0; i < 3; i++) {
            const angle = t + (i * Math.PI * 2) / 3;
            const ox = cx + Math.cos(angle) * radius * 0.35;
            const oy = cy + Math.sin(angle) * radius * 0.35;
            ctx.fillStyle = theme.nucleus;
            ctx.beginPath();
            ctx.arc(ox, oy, radius * 0.14, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.globalAlpha = alpha * 0.78;
        const highlight = ctx.createRadialGradient(cx - radius * 0.25, cy - radius * 0.26, 0, cx, cy, radius * 0.9);
        highlight.addColorStop(0, "rgba(255,255,255,0.66)");
        highlight.addColorStop(1, "transparent");
        ctx.fillStyle = highlight;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();

        if (color === JOKER_COLOR) {
            this.drawJokerSymbol(cx, cy, radius * 0.52, alpha);
        }

        ctx.restore();
    }

    private drawJokerSymbol(cx: number, cy: number, r: number, alpha: number) {
        const ctx = this.ctx;
        const rot = this.animFrame * 0.015;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(cx, cy);
        ctx.rotate(rot);
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const a = (i * Math.PI) / 3;
            const x = Math.cos(a) * r;
            const y = Math.sin(a) * r;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();

        ctx.rotate(-rot * 1.7);
        ctx.strokeStyle = "rgba(255,235,170,0.95)";
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.95);
        ctx.lineTo(0, r * 0.95);
        ctx.moveTo(-r * 0.95, 0);
        ctx.lineTo(r * 0.95, 0);
        ctx.stroke();
        ctx.restore();
    }

    getThemeColor(colorIdx: CellColor): string {
        if (colorIdx === JOKER_COLOR) return JOKER_THEME.core;
        if (colorIdx < 0) return "transparent";
        return CELL_THEMES[colorIdx % CELL_THEMES.length].core;
    }

    getCanvas(): HTMLCanvasElement {
        return this.canvas;
    }
}
