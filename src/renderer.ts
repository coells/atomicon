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
    /* 0 Cat  – vivid red    */ {
        core: "#FF2D4F",
        glow: "rgba(255,45,79,0.42)",
        membrane: "#FF6B83",
        nucleus: "#BF1030",
    },
    /* 1 Fish – deep blue    */ {
        core: "#1E80FF",
        glow: "rgba(30,128,255,0.42)",
        membrane: "#60A8FF",
        nucleus: "#0050CC",
    },
    /* 2 Frog – vivid green  */ {
        core: "#2DD855",
        glow: "rgba(45,216,85,0.42)",
        membrane: "#72E890",
        nucleus: "#14A832",
    },
    /* 3 Fox  – orange       */ {
        core: "#FF8C00",
        glow: "rgba(255,140,0,0.42)",
        membrane: "#FFB347",
        nucleus: "#CC6600",
    },
    /* 4 Owl  – rich purple  */ {
        core: "#9B30FF",
        glow: "rgba(155,48,255,0.42)",
        membrane: "#BE7DFF",
        nucleus: "#6B0FBF",
    },
    /* 5 Bunny– hot pink     */ {
        core: "#FF4DAE",
        glow: "rgba(255,77,174,0.42)",
        membrane: "#FF8DC7",
        nucleus: "#D4287A",
    },
    /* 6 Penguin–bright teal */ {
        core: "#00CED1",
        glow: "rgba(0,206,209,0.42)",
        membrane: "#4DE8EA",
        nucleus: "#008B8E",
    },
];

const JOKER_THEME: CellTheme = {
    core: "#ffd86b",
    glow: "rgba(255,216,107,0.45)",
    membrane: "#ffe59e",
    nucleus: "#d6a72f",
};

/** Five colors used for joker segments */
const JOKER_SEGMENT_COLORS = [
    CELL_THEMES[0].core, // red
    CELL_THEMES[1].core, // blue
    CELL_THEMES[2].core, // green
    CELL_THEMES[3].core, // orange
    CELL_THEMES[4].core, // purple
];

const CHARACTER_NAMES = ["cat", "fish", "frog", "fox", "owl", "bunny", "penguin"] as const;

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

    /** Trail particles emitted during path movement */
    private trailParticles: { x: number; y: number; vx: number; vy: number; life: number; color: string }[] = [];

    private comboLevel = 0; // 0 = no combo, 2 = 2x, 3 = 3x, etc.

    /** Ambient particle color cycling (independent of combo) */
    private readonly ambientPalette: [number, number, number][] = [
        [174, 219, 255], // cool blue/white (default)
        [180, 255, 210], // mint green
        [220, 180, 255], // soft lavender
        [255, 200, 160], // warm peach
        [160, 230, 255], // sky blue
        [255, 180, 220], // soft pink
        [200, 255, 180], // lime
    ];
    private ambientColorIdx = 0;
    private ambientColorNext = 1;
    private ambientBlend = 0; // 0..1 interpolation between idx and next
    private lastColorCycleTime = performance.now();
    private colorCycleDuration = 60000; // ms until next color switch
    private colorTransitionDuration = 3000; // ms for smooth blend
    private colorTransitioning = false;

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

    setComboLevel(level: number) {
        this.comboLevel = level;
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

        this.drawSceneParticles();

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
            this.emitTrailParticles(p.x, p.y, this.pathAnim.color);
            this.drawMicroCell(p.x, p.y, this.pathAnim.color, 1, 1, true);
            this.drawPathTrail(this.pathAnim.path, this.pathAnim.progress);
        }

        this.updateAndDrawTrailParticles();

        this.updateAnimations();
        this.selectedBounce += 0.14;
    }

    /** Advance ambient color cycling timer */
    private tickAmbientColor() {
        const now = performance.now();
        if (!this.colorTransitioning) {
            // Check if it's time to start a new transition
            if (now - this.lastColorCycleTime >= this.colorCycleDuration) {
                this.colorTransitioning = true;
                this.ambientColorNext =
                    (this.ambientColorIdx + 1 + Math.floor(Math.random() * (this.ambientPalette.length - 1))) %
                    this.ambientPalette.length;
                this.ambientBlend = 0;
                this.lastColorCycleTime = now;
            }
        } else {
            // Smoothly blend
            this.ambientBlend = Math.min(1, (now - this.lastColorCycleTime) / this.colorTransitionDuration);
            if (this.ambientBlend >= 1) {
                this.ambientColorIdx = this.ambientColorNext;
                this.ambientBlend = 0;
                this.colorTransitioning = false;
                this.lastColorCycleTime = now;
                // Randomize next interval between 45-75s
                this.colorCycleDuration = 45000 + Math.random() * 30000;
            }
        }
    }

    /** Get the current ambient particle color, blended between palette entries */
    private getAmbientColor(): [number, number, number] {
        const a = this.ambientPalette[this.ambientColorIdx];
        if (!this.colorTransitioning) return a;
        const b = this.ambientPalette[this.ambientColorNext];
        const t = this.ambientBlend;
        // Smooth ease-in-out
        const s = t * t * (3 - 2 * t);
        return [
            Math.round(a[0] + (b[0] - a[0]) * s),
            Math.round(a[1] + (b[1] - a[1]) * s),
            Math.round(a[2] + (b[2] - a[2]) * s),
        ];
    }

    private drawSceneParticles() {
        const ctx = this.ctx;
        // Speed multiplier based on combo level
        const speedMult = this.comboLevel >= 3 ? 2.5 : this.comboLevel >= 2 ? 1.7 : 1;
        const t = this.animFrame * 0.01 * speedMult;
        const count = this.comboLevel >= 3 ? 40 : this.comboLevel >= 2 ? 34 : 28;

        // Advance ambient color cycling
        this.tickAmbientColor();

        // Color: combo overrides ambient cycling
        let particleR: number, particleG: number, particleB: number;
        if (this.comboLevel >= 3) {
            particleR = 255;
            particleG = 100;
            particleB = 80;
        } else if (this.comboLevel >= 2) {
            particleR = 255;
            particleG = 220;
            particleB = 100;
        } else {
            const [ar, ag, ab] = this.getAmbientColor();
            particleR = ar;
            particleG = ag;
            particleB = ab;
        }

        for (let i = 0; i < count; i++) {
            const px = ((i * 139 + t * 240) % (this.boardSize + 90)) - 45;
            const py = ((i * 83 + t * 120 + Math.sin(i * 1.3 + t * 2) * 28) % (this.boardSize + 90)) - 45;
            const r = 1.8 + (i % 4) * 0.8;
            const glow = ctx.createRadialGradient(px, py, 0, px, py, r * 3);
            glow.addColorStop(0, `rgba(${particleR}, ${particleG}, ${particleB}, 0.5)`);
            glow.addColorStop(1, `rgba(${particleR}, ${particleG}, ${particleB}, 0)`);
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(px, py, r * 3, 0, Math.PI * 2);
            ctx.fill();
        }
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

    /** Emit a few sparkle particles at the moving cell's current position */
    private emitTrailParticles(cx: number, cy: number, color: CellColor) {
        const theme = color === JOKER_COLOR ? JOKER_THEME : CELL_THEMES[color % CELL_THEMES.length];
        // Emit 1-2 particles per frame
        const count = 1 + (this.animFrame % 2 === 0 ? 1 : 0);
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
        const decay = 0.025;
        for (let i = this.trailParticles.length - 1; i >= 0; i--) {
            const p = this.trailParticles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.vx *= 0.96;
            p.vy *= 0.96;
            p.life -= decay;
            if (p.life <= 0) {
                this.trailParticles.splice(i, 1);
                continue;
            }

            const r = 1.5 + p.life * 2.5;
            const alpha = p.life * 0.7;

            // Soft glow
            const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.5);
            glow.addColorStop(0, p.color + this.alphaHex(alpha));
            glow.addColorStop(1, p.color + "00");
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r * 2.5, 0, Math.PI * 2);
            ctx.fill();

            // Bright core
            ctx.fillStyle = `rgba(255,255,255,${alpha * 0.8})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r * 0.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    /** Convert 0..1 alpha to 2-char hex suffix */
    private alphaHex(a: number): string {
        return Math.round(Math.min(1, Math.max(0, a)) * 255)
            .toString(16)
            .padStart(2, "0");
    }

    private updateAnimations() {
        let finished = false;

        if (this.pathAnim) {
            const segments = Math.max(1, this.pathAnim.path.length - 1);
            // Slower movement: ~60% of original speed
            this.pathAnim.progress += Math.min(0.065, 0.4 / segments);
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
        const t = this.animFrame * 0.04;

        ctx.save();
        ctx.globalAlpha = alpha;

        const bob = Math.sin(t + (cx + cy) * 0.01) * radius * 0.03;
        cy += bob;

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

        // Draw character
        if (color === JOKER_COLOR) {
            this.drawJokerCharacter(cx, cy, radius, theme, t);
        } else {
            const idx = color % CELL_THEMES.length;
            switch (idx) {
                case 0:
                    this.drawCat(cx, cy, radius, theme, t);
                    break;
                case 1:
                    this.drawFish(cx, cy, radius, theme, t);
                    break;
                case 2:
                    this.drawFrog(cx, cy, radius, theme, t);
                    break;
                case 3:
                    this.drawFox(cx, cy, radius, theme, t);
                    break;
                case 4:
                    this.drawOwl(cx, cy, radius, theme, t);
                    break;
                case 5:
                    this.drawBunny(cx, cy, radius, theme, t);
                    break;
                case 6:
                    this.drawPenguin(cx, cy, radius, theme, t);
                    break;
            }
        }

        ctx.restore();
    }

    /* ─── shared helpers ─── */

    private drawBodyCircle(cx: number, cy: number, r: number, theme: CellTheme) {
        const ctx = this.ctx;
        const g = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.2, r * 0.1, cx, cy, r);
        g.addColorStop(0, theme.membrane);
        g.addColorStop(0.65, theme.core);
        g.addColorStop(1, theme.nucleus);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
    }

    private drawGloss(cx: number, cy: number, r: number) {
        const ctx = this.ctx;
        const a = ctx.globalAlpha;
        ctx.globalAlpha *= 0.4;
        const hl = ctx.createRadialGradient(cx - r * 0.22, cy - r * 0.28, 0, cx, cy, r * 0.85);
        hl.addColorStop(0, "rgba(255,255,255,0.75)");
        hl.addColorStop(1, "transparent");
        ctx.fillStyle = hl;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = a;
    }

    /* ── 0  CAT (Red) ── */
    private drawCat(cx: number, cy: number, r: number, theme: CellTheme, t: number) {
        const ctx = this.ctx;
        const blink = Math.sin(t * 0.35 + cx * 0.04) > 0.92 ? 0.15 : 1;
        const earW = Math.sin(t * 2.1) * 0.06;
        const whisk = Math.sin(t * 1.8) * r * 0.04;

        this.drawBodyCircle(cx, cy, r, theme);

        // ears
        for (const s of [-1, 1]) {
            ctx.fillStyle = theme.nucleus;
            ctx.beginPath();
            ctx.moveTo(cx + s * r * 0.6, cy - r * 0.35);
            ctx.lineTo(cx + s * (r * 0.3 + earW * r), cy - r * 1.18);
            ctx.lineTo(cx + s * r * 0.05, cy - r * 0.7);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = theme.membrane;
            ctx.beginPath();
            ctx.moveTo(cx + s * r * 0.5, cy - r * 0.4);
            ctx.lineTo(cx + s * (r * 0.3 + earW * r), cy - r * 0.98);
            ctx.lineTo(cx + s * r * 0.15, cy - r * 0.65);
            ctx.closePath();
            ctx.fill();
        }

        this.drawGloss(cx, cy, r);

        // slit eyes
        const eyeY = cy - r * 0.12;
        for (const s of [-1, 1]) {
            ctx.save();
            ctx.translate(cx + s * r * 0.26, eyeY);
            ctx.rotate(s * -0.15);
            ctx.fillStyle = "#1a1a28";
            ctx.beginPath();
            ctx.ellipse(0, 0, r * 0.13, r * 0.1 * blink, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#40FF70";
            ctx.beginPath();
            ctx.ellipse(0, 0, r * 0.035, r * 0.08 * blink, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        // nose
        const ny = cy + r * 0.08;
        ctx.fillStyle = "#FFB0C0";
        ctx.beginPath();
        ctx.moveTo(cx, ny + r * 0.07);
        ctx.lineTo(cx - r * 0.06, ny);
        ctx.lineTo(cx + r * 0.06, ny);
        ctx.closePath();
        ctx.fill();

        // mouth
        ctx.strokeStyle = "#1a1a28cc";
        ctx.lineWidth = r * 0.045;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(cx - r * 0.07, ny + r * 0.13, r * 0.08, -0.6, 0.2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx + r * 0.07, ny + r * 0.13, r * 0.08, Math.PI - 0.2, Math.PI + 0.6);
        ctx.stroke();

        // whiskers
        ctx.strokeStyle = "rgba(255,255,255,0.6)";
        ctx.lineWidth = r * 0.025;
        for (const s of [-1, 1]) {
            for (let j = -1; j <= 1; j++) {
                ctx.beginPath();
                ctx.moveTo(cx + s * r * 0.22, ny + r * 0.05 + j * r * 0.07);
                ctx.lineTo(cx + s * r * 0.88 + whisk * s, ny + j * r * 0.14 + whisk * 0.5);
                ctx.stroke();
            }
        }
    }

    /* ── 1  FISH (Blue) ── */
    private drawFish(cx: number, cy: number, r: number, theme: CellTheme, t: number) {
        const ctx = this.ctx;
        const blink = Math.sin(t * 0.3 + cy * 0.05) > 0.93 ? 0.2 : 1;
        const wig = Math.sin(t * 2.5) * r * 0.03;
        const tailW = Math.sin(t * 3) * 0.25;

        // oval body
        const g = ctx.createRadialGradient(cx - r * 0.15, cy - r * 0.2, r * 0.1, cx, cy, r);
        g.addColorStop(0, theme.membrane);
        g.addColorStop(0.6, theme.core);
        g.addColorStop(1, theme.nucleus);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(cx + wig, cy, r * 1.05, r * 0.85, 0, 0, Math.PI * 2);
        ctx.fill();

        // tail
        ctx.fillStyle = theme.nucleus;
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.85 + wig, cy);
        ctx.lineTo(cx - r * 1.35, cy - r * 0.5 + tailW * r);
        ctx.lineTo(cx - r * 1.35, cy + r * 0.5 + tailW * r);
        ctx.closePath();
        ctx.fill();

        // dorsal fin
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.15 + wig, cy - r * 0.8);
        ctx.lineTo(cx + r * 0.15 + wig, cy - r * 1.1);
        ctx.lineTo(cx + r * 0.35 + wig, cy - r * 0.75);
        ctx.closePath();
        ctx.fill();

        this.drawGloss(cx + wig, cy, r * 0.95);

        // scales
        ctx.strokeStyle = "rgba(255,255,255,0.18)";
        ctx.lineWidth = r * 0.03;
        for (let rw = 0; rw < 2; rw++)
            for (let cl = 0; cl < 3; cl++) {
                ctx.beginPath();
                ctx.arc(cx - r * 0.3 + cl * r * 0.3 + wig, cy - r * 0.15 + rw * r * 0.3, r * 0.12, 0.3, Math.PI - 0.3);
                ctx.stroke();
            }

        // eye
        ctx.fillStyle = "white";
        ctx.beginPath();
        ctx.ellipse(cx + r * 0.4 + wig, cy - r * 0.12, r * 0.16, r * 0.18 * blink, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#0a0a2a";
        ctx.beginPath();
        ctx.ellipse(cx + r * 0.43 + wig, cy - r * 0.12, r * 0.08, r * 0.1 * blink, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "white";
        ctx.beginPath();
        ctx.arc(cx + r * 0.46 + wig, cy - r * 0.17, r * 0.035, 0, Math.PI * 2);
        ctx.fill();

        // mouth
        ctx.strokeStyle = "#0a0a2acc";
        ctx.lineWidth = r * 0.05;
        ctx.beginPath();
        ctx.ellipse(cx + r * 0.7 + wig, cy + r * 0.05, r * 0.06, r * 0.08, 0, 0, Math.PI * 2);
        ctx.stroke();

        // bubbles
        ctx.strokeStyle = "rgba(200,230,255,0.5)";
        ctx.lineWidth = r * 0.03;
        const bt = t * 1.5;
        for (let i = 0; i < 3; i++) {
            const by = cy - r * 0.4 - ((bt + i * 1.2) % 3) * r * 0.3;
            const bx = cx + r * 0.8 + Math.sin(bt * 0.7 + i) * r * 0.1;
            ctx.beginPath();
            ctx.arc(bx, by, r * (0.04 + i * 0.02), 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    /* ── 2  FROG (Green) ── */
    private drawFrog(cx: number, cy: number, r: number, theme: CellTheme, t: number) {
        const ctx = this.ctx;
        const blL = Math.sin(t * 0.33 + cx * 0.03) > 0.9 ? 0.15 : 1;
        const blR = Math.sin(t * 0.33 + cx * 0.03 + 0.5) > 0.93 ? 0.15 : 1;
        const throat = Math.sin(t * 1.2) * r * 0.04;

        this.drawBodyCircle(cx, cy + r * 0.08, r * 0.95, theme);

        // bulging eyes
        for (const s of [-1, 1]) {
            const ex = cx + s * r * 0.42,
                ey = cy - r * 0.62;
            const bl = s === -1 ? blL : blR;
            ctx.fillStyle = theme.core;
            ctx.beginPath();
            ctx.arc(ex, ey, r * 0.35, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#ffffffee";
            ctx.beginPath();
            ctx.ellipse(ex, ey, r * 0.25, r * 0.26 * bl, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#0a2a0a";
            ctx.beginPath();
            ctx.ellipse(ex + s * r * 0.04, ey, r * 0.12, r * 0.14 * bl, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "white";
            ctx.beginPath();
            ctx.arc(ex + s * r * 0.07, ey - r * 0.08, r * 0.06, 0, Math.PI * 2);
            ctx.fill();
        }

        this.drawGloss(cx, cy + r * 0.08, r * 0.95);

        // spots
        ctx.fillStyle = theme.nucleus + "40";
        ctx.beginPath();
        ctx.arc(cx - r * 0.35, cy + r * 0.15, r * 0.12, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx + r * 0.28, cy - r * 0.05, r * 0.09, 0, Math.PI * 2);
        ctx.fill();

        // wide grin
        ctx.strokeStyle = "#0a2a0acc";
        ctx.lineWidth = r * 0.06;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(cx, cy + r * 0.15 + throat, r * 0.45, 0.15, Math.PI - 0.15);
        ctx.stroke();

        // blush
        ctx.fillStyle = "rgba(255,180,200,0.25)";
        for (const s of [-1, 1]) {
            ctx.beginPath();
            ctx.ellipse(cx + s * r * 0.5, cy + r * 0.2, r * 0.12, r * 0.08, 0, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    /* ── 3  FOX (Orange) ── */
    private drawFox(cx: number, cy: number, r: number, theme: CellTheme, t: number) {
        const ctx = this.ctx;
        const blink = Math.sin(t * 0.32 + cy * 0.04) > 0.91 ? 0.15 : 1;
        const earF = Math.sin(t * 1.9) * 0.04;

        this.drawBodyCircle(cx, cy, r, theme);

        // ears
        for (const s of [-1, 1]) {
            ctx.fillStyle = theme.nucleus;
            ctx.beginPath();
            ctx.moveTo(cx + s * r * 0.62, cy - r * 0.28);
            ctx.lineTo(cx + s * (r * 0.42 + earF * r), cy - r * 1.22);
            ctx.lineTo(cx + s * r * 0.08, cy - r * 0.68);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = "#2a1a0a";
            ctx.beginPath();
            ctx.moveTo(cx + s * r * 0.52, cy - r * 0.35);
            ctx.lineTo(cx + s * (r * 0.42 + earF * r), cy - r * 1.02);
            ctx.lineTo(cx + s * r * 0.18, cy - r * 0.6);
            ctx.closePath();
            ctx.fill();
        }

        // white muzzle
        ctx.fillStyle = "rgba(255,250,240,0.85)";
        ctx.beginPath();
        ctx.ellipse(cx, cy + r * 0.25, r * 0.4, r * 0.38, 0, 0, Math.PI * 2);
        ctx.fill();

        this.drawGloss(cx, cy, r);

        // sly eyes
        const eyeY = cy - r * 0.1;
        for (const s of [-1, 1]) {
            ctx.save();
            ctx.translate(cx + s * r * 0.28, eyeY);
            ctx.rotate(s * 0.12);
            ctx.fillStyle = "#1a1008";
            ctx.beginPath();
            ctx.ellipse(0, 0, r * 0.14, r * 0.07 * blink, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#FFB020";
            ctx.beginPath();
            ctx.ellipse(0, 0, r * 0.06, r * 0.05 * blink, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        // nose
        ctx.fillStyle = "#1a1008";
        ctx.beginPath();
        ctx.arc(cx, cy + r * 0.12, r * 0.07, 0, Math.PI * 2);
        ctx.fill();

        // smirk
        ctx.strokeStyle = "#1a1008cc";
        ctx.lineWidth = r * 0.04;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(cx + r * 0.03, cy + r * 0.22, r * 0.15, 0.1, Math.PI - 0.5);
        ctx.stroke();
    }

    /* ── 4  OWL (Purple) ── */
    private drawOwl(cx: number, cy: number, r: number, theme: CellTheme, t: number) {
        const ctx = this.ctx;
        const pupil = 0.85 + Math.sin(t * 0.8) * 0.15;
        const tilt = Math.sin(t * 0.6) * 0.06;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(tilt);
        ctx.translate(-cx, -cy);

        this.drawBodyCircle(cx, cy, r, theme);

        // ear tufts
        for (const s of [-1, 1]) {
            ctx.fillStyle = theme.nucleus;
            ctx.beginPath();
            ctx.moveTo(cx + s * r * 0.45, cy - r * 0.65);
            ctx.lineTo(cx + s * r * 0.3, cy - r * 1.2);
            ctx.lineTo(cx + s * r * 0.15, cy - r * 0.7);
            ctx.closePath();
            ctx.fill();
        }

        // wing ridges
        ctx.strokeStyle = theme.nucleus + "80";
        ctx.lineWidth = r * 0.06;
        ctx.lineCap = "round";
        for (const s of [-1, 1]) {
            ctx.beginPath();
            ctx.arc(
                cx + s * r * 0.6,
                cy + r * 0.1,
                r * 0.35,
                s === 1 ? Math.PI * 0.6 : -Math.PI * 0.15,
                s === 1 ? Math.PI * 1.4 : Math.PI * 0.65,
            );
            ctx.stroke();
        }

        this.drawGloss(cx, cy, r);

        // big round eyes
        const eyeY = cy - r * 0.1;
        for (const s of [-1, 1]) {
            ctx.strokeStyle = theme.membrane;
            ctx.lineWidth = r * 0.06;
            ctx.beginPath();
            ctx.arc(cx + s * r * 0.28, eyeY, r * 0.25, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = "#FFF8E0";
            ctx.beginPath();
            ctx.arc(cx + s * r * 0.28, eyeY, r * 0.22, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#1a0a28";
            ctx.beginPath();
            ctx.arc(cx + s * r * 0.28, eyeY, r * 0.13 * pupil, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "white";
            ctx.beginPath();
            ctx.arc(cx + s * r * 0.32, eyeY - r * 0.06, r * 0.05, 0, Math.PI * 2);
            ctx.fill();
        }

        // beak
        ctx.fillStyle = "#FFB030";
        ctx.beginPath();
        ctx.moveTo(cx, eyeY + r * 0.22);
        ctx.lineTo(cx - r * 0.08, eyeY + r * 0.12);
        ctx.lineTo(cx + r * 0.08, eyeY + r * 0.12);
        ctx.closePath();
        ctx.fill();

        ctx.restore();
    }

    /* ── 5  BUNNY (Pink) ── */
    private drawBunny(cx: number, cy: number, r: number, theme: CellTheme, t: number) {
        const ctx = this.ctx;
        const blink = Math.sin(t * 0.36 + cx * 0.05) > 0.91 ? 0.15 : 1;
        const earFlop = Math.sin(t * 1.3) * 0.08;
        const noseTw = Math.sin(t * 3.5) * r * 0.015;

        this.drawBodyCircle(cx, cy + r * 0.05, r * 0.95, theme);

        // long ears
        for (const s of [-1, 1]) {
            ctx.save();
            ctx.translate(cx + s * r * 0.25, cy - r * 0.6);
            ctx.rotate(s * (0.2 + earFlop));
            ctx.fillStyle = theme.core;
            ctx.beginPath();
            ctx.ellipse(0, -r * 0.55, r * 0.2, r * 0.58, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = theme.membrane;
            ctx.beginPath();
            ctx.ellipse(0, -r * 0.55, r * 0.12, r * 0.45, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        this.drawGloss(cx, cy + r * 0.05, r * 0.95);

        // sparkly eyes
        const eyeY = cy - r * 0.08;
        for (const s of [-1, 1]) {
            ctx.fillStyle = "#1a0a1a";
            ctx.beginPath();
            ctx.ellipse(cx + s * r * 0.24, eyeY, r * 0.12, r * 0.14 * blink, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "white";
            ctx.beginPath();
            ctx.arc(cx + s * r * 0.28, eyeY - r * 0.06, r * 0.04, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(cx + s * r * 0.2, eyeY + r * 0.02, r * 0.025, 0, Math.PI * 2);
            ctx.fill();
        }

        // twitching nose
        ctx.fillStyle = "#FF8095";
        ctx.beginPath();
        ctx.ellipse(cx + noseTw, cy + r * 0.12, r * 0.06, r * 0.045, 0, 0, Math.PI * 2);
        ctx.fill();

        // buck teeth
        ctx.fillStyle = "white";
        ctx.strokeStyle = "#ddd";
        ctx.lineWidth = r * 0.02;
        for (const s of [-0.5, 0.5]) {
            const tx = cx + s * r * 0.08 - r * 0.04;
            ctx.beginPath();
            ctx.rect(tx, cy + r * 0.18, r * 0.08, r * 0.11);
            ctx.fill();
            ctx.stroke();
        }

        // rosy cheeks
        ctx.fillStyle = "rgba(255,150,180,0.3)";
        for (const s of [-1, 1]) {
            ctx.beginPath();
            ctx.ellipse(cx + s * r * 0.45, cy + r * 0.08, r * 0.12, r * 0.08, 0, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    /* ── 6  PENGUIN (Teal) ── */
    private drawPenguin(cx: number, cy: number, r: number, theme: CellTheme, t: number) {
        const ctx = this.ctx;
        const blink = Math.sin(t * 0.34 + cy * 0.03) > 0.92 ? 0.2 : 1;
        const waddle = Math.sin(t * 2.2) * 0.05;
        const flipW = Math.sin(t * 2) * 0.15;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(waddle);
        ctx.translate(-cx, -cy);

        // dark body
        const g = ctx.createRadialGradient(cx - r * 0.1, cy - r * 0.15, r * 0.1, cx, cy, r);
        g.addColorStop(0, "#2a4a5a");
        g.addColorStop(0.6, theme.nucleus);
        g.addColorStop(1, "#0a2a2a");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();

        // white belly
        ctx.fillStyle = "rgba(240,252,255,0.92)";
        ctx.beginPath();
        ctx.ellipse(cx, cy + r * 0.15, r * 0.55, r * 0.65, 0, 0, Math.PI * 2);
        ctx.fill();

        // flippers
        for (const s of [-1, 1]) {
            ctx.fillStyle = theme.nucleus;
            ctx.save();
            ctx.translate(cx + s * r * 0.8, cy - r * 0.05);
            ctx.rotate(s * (0.4 + flipW));
            ctx.beginPath();
            ctx.ellipse(0, 0, r * 0.15, r * 0.38, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        this.drawGloss(cx, cy, r);

        // eyes
        const eyeY = cy - r * 0.18;
        for (const s of [-1, 1]) {
            ctx.fillStyle = "white";
            ctx.beginPath();
            ctx.ellipse(cx + s * r * 0.22, eyeY, r * 0.12, r * 0.14 * blink, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#0a0a1a";
            ctx.beginPath();
            ctx.ellipse(cx + s * r * 0.22, eyeY, r * 0.07, r * 0.09 * blink, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "white";
            ctx.beginPath();
            ctx.arc(cx + s * r * 0.25, eyeY - r * 0.05, r * 0.03, 0, Math.PI * 2);
            ctx.fill();
        }

        // orange beak
        ctx.fillStyle = "#FFA030";
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.1, cy + r * 0.02);
        ctx.lineTo(cx, cy + r * 0.16);
        ctx.lineTo(cx + r * 0.1, cy + r * 0.02);
        ctx.closePath();
        ctx.fill();

        // blush
        ctx.fillStyle = "rgba(255,180,200,0.3)";
        for (const s of [-1, 1]) {
            ctx.beginPath();
            ctx.ellipse(cx + s * r * 0.38, cy + r * 0.05, r * 0.1, r * 0.06, 0, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }

    /* ── JOKER (5-color pinwheel) ── */
    private drawJokerCharacter(cx: number, cy: number, r: number, _theme: CellTheme, t: number) {
        const ctx = this.ctx;
        const rot = t * 0.4;
        const sparkle = 0.85 + Math.sin(t * 2) * 0.15;
        const segCount = JOKER_SEGMENT_COLORS.length;
        const segAngle = (Math.PI * 2) / segCount;

        // Draw 5-color pinwheel body
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rot);
        for (let i = 0; i < segCount; i++) {
            const startA = segAngle * i - Math.PI / 2;
            const endA = startA + segAngle;
            ctx.fillStyle = JOKER_SEGMENT_COLORS[i];
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.arc(0, 0, r, startA, endA);
            ctx.closePath();
            ctx.fill();
        }
        // Lighter inner ring for depth
        for (let i = 0; i < segCount; i++) {
            const startA = segAngle * i - Math.PI / 2;
            const endA = startA + segAngle;
            ctx.fillStyle = JOKER_SEGMENT_COLORS[(i + 2) % segCount] + "55";
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.arc(0, 0, r * 0.5, startA, endA);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();

        // White shimmer overlay
        const hl = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.25, 0, cx, cy, r * 0.85);
        hl.addColorStop(0, "rgba(255,255,255,0.4)");
        hl.addColorStop(1, "transparent");
        ctx.fillStyle = hl;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();

        // Spinning white star outline
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rot * -0.6);
        ctx.strokeStyle = "rgba(255,255,255,0.5)";
        ctx.lineWidth = r * 0.04;
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
            const a = (i * Math.PI) / 5 - Math.PI / 2;
            const d = i % 2 === 0 ? r * 0.65 : r * 0.3;
            if (i === 0) ctx.moveTo(Math.cos(a) * d, Math.sin(a) * d);
            else ctx.lineTo(Math.cos(a) * d, Math.sin(a) * d);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.restore();

        // happy face on top
        const blink = Math.sin(t * 0.35) > 0.92 ? 0.15 : 1;
        const eyeY = cy - r * 0.14;
        for (const s of [-1, 1]) {
            ctx.fillStyle = "#1a1a28dd";
            ctx.beginPath();
            ctx.ellipse(cx + s * r * 0.22, eyeY, r * 0.09, r * 0.11 * blink * sparkle, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "white";
            ctx.beginPath();
            ctx.arc(cx + s * r * 0.25, eyeY - r * 0.04, r * 0.03, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.strokeStyle = "#1a1a28cc";
        ctx.lineWidth = r * 0.06;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(cx, cy + r * 0.1, r * 0.2, 0.2, Math.PI - 0.2);
        ctx.stroke();

        ctx.fillStyle = "rgba(255,255,255,0.2)";
        for (const s of [-1, 1]) {
            ctx.beginPath();
            ctx.ellipse(cx + s * r * 0.35, cy + r * 0.08, r * 0.1, r * 0.06, 0, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    getThemeColor(colorIdx: CellColor): string {
        if (colorIdx === JOKER_COLOR) {
            // Return a CSS conic gradient for preview dots
            return JOKER_SEGMENT_COLORS[Math.floor(Math.random() * JOKER_SEGMENT_COLORS.length)];
        }
        if (colorIdx < 0) return "transparent";
        return CELL_THEMES[colorIdx % CELL_THEMES.length].core;
    }

    getCanvas(): HTMLCanvasElement {
        return this.canvas;
    }
}
