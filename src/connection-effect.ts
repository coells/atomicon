import { cellIndex, GRID_SIZE, JOKER_COLOR, MIN_MATCH, type Grid, type Position } from "./game";

export const CONNECTION_DURATION_MS = 460;

export interface Point {
    x: number;
    y: number;
}

interface ChargedStone {
    index: number;
    color: number;
    arrival: number;
    strength: number;
}

interface Connection {
    from: number;
    to: number;
}

/** A spanning forest follows touching stones, never empty cells or unrelated colors. */
export function planConnections(positions: Set<number>, grid: Grid, origin?: Position) {
    const remaining = new Set(positions);
    const stones = new Map<number, ChargedStone>();
    const connections: Connection[] = [];
    const preferred = origin && cellIndex(origin);
    const roots = preferred !== undefined && remaining.has(preferred) ? [preferred, ...remaining] : [...remaining];
    for (const root of roots) {
        if (!remaining.delete(root)) continue;
        const queue = [{ index: root, depth: 0 }];
        let maxDepth = 0;
        for (let head = 0; head < queue.length; head++) {
            const current = queue[head];
            const row = Math.floor(current.index / GRID_SIZE);
            const col = current.index % GRID_SIZE;
            const color = grid[row][col].color;
            for (const [dr, dc] of [
                [0, 1],
                [1, 0],
                [1, -1],
                [0, -1],
                [-1, 0],
                [-1, 1],
            ]) {
                const nextRow = row + dr;
                const nextCol = col + dc;
                if (nextRow < 0 || nextRow >= GRID_SIZE || nextCol < 0 || nextCol >= GRID_SIZE) continue;
                const index = cellIndex({ row: nextRow, col: nextCol });
                if (!remaining.has(index)) continue;
                const nextColor = grid[nextRow][nextCol].color;
                if (color !== nextColor && color !== JOKER_COLOR && nextColor !== JOKER_COLOR) continue;
                remaining.delete(index);
                maxDepth = current.depth + 1;
                queue.push({ index, depth: maxDepth });
                connections.push({ from: current.index, to: index });
            }
        }
        const strength = Math.min(1, Math.max(0, (queue.length - MIN_MATCH) / 7));
        for (const { index, depth } of queue) {
            stones.set(index, {
                index,
                color: grid[Math.floor(index / GRID_SIZE)][index % GRID_SIZE].color,
                arrival: maxDepth ? (depth / maxDepth) * 0.38 : 0,
                strength,
            });
        }
    }
    return { stones, connections };
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Smooth, seeded noise: no random-number consumption or harsh flicker per frame. */
function noise(seed: number) {
    const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
    return (value - Math.floor(value)) * 2 - 1;
}

/** One reusable point buffer per bolt; only its coordinates change during a clear. */
export class LightningBolt {
    private points = Array.from({ length: 9 }, () => ({ x: 0, y: 0 }));
    private samples: { t: number; jitter: number; phase: number; envelope: number }[];

    constructor(seed: number, strength: number) {
        this.samples = Array.from({ length: 7 }, (_, index) => {
            const i = index + 1;
            return {
                t: i / 8,
                jitter: noise(seed + i),
                phase: seed + i * 2.3,
                envelope: (0.075 + strength * 0.05) * Math.sin((i / 8) * Math.PI),
            };
        });
    }

    /** The returned buffer is borrowed: it stays valid until the next update. */
    update(from: Point, to: Point, time: number): readonly Point[] {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        this.points[0].x = from.x;
        this.points[0].y = from.y;
        for (let i = 0; i < this.samples.length; i++) {
            const sample = this.samples[i];
            const offset = (sample.jitter + Math.sin(time * 18 + sample.phase) * 0.3) * sample.envelope;
            this.points[i + 1].x = from.x + dx * sample.t - dy * offset;
            this.points[i + 1].y = from.y + dy * sample.t + dx * offset;
        }
        this.points[8].x = to.x;
        this.points[8].y = to.y;
        return this.points;
    }
}

/** Fixed-size glow sprites shared by every clear and retained across board resizes. */
export class ConnectionSprites {
    private cache: { color: string; glow: HTMLCanvasElement }[] = [];

    constructor(private colors: readonly string[]) {}

    get(index: number) {
        let sprite = this.cache[index];
        if (!sprite) {
            const color = this.colors[index];
            const glow = document.createElement("canvas");
            glow.width = glow.height = 64;
            const ctx = glow.getContext("2d")!;
            const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
            gradient.addColorStop(0, color + "99");
            gradient.addColorStop(0.35, color + "55");
            gradient.addColorStop(1, color + "00");
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 64, 64);
            sprite = { color, glow };
            this.cache[index] = sprite;
        }
        return sprite;
    }
}

interface StoneVisual extends ChargedStone {
    appearance: { alpha: number; scale: number };
    sparks: { dx: number; dy: number; reach: number }[];
}

interface ConnectionVisual {
    from: StoneVisual;
    to: StoneVisual;
    bolt: LightningBolt;
    branch: LightningBolt | null;
    branchSide: number;
}

/** One bounded charge → discharge → dissolve; all geometry stays in board coordinates. */
export class ConnectionEffect {
    private stones = new Map<number, StoneVisual>();
    private connections: ConnectionVisual[];
    private end = { x: 0, y: 0 };
    private tip = { x: 0, y: 0 };
    progress = 0;

    constructor(positions: Set<number>, grid: Grid, origin?: Position) {
        const plan = planConnections(positions, grid, origin);
        const seed = Math.random() * 1000;
        // A board-wide clear still has at most 96 sparks, not 8 × 60.
        const sparkBudget = Math.floor(96 / Math.max(1, plan.stones.size));
        for (const stone of plan.stones.values()) {
            const count = Math.min(3 + Math.round(stone.strength * 5), sparkBudget);
            const sparks = Array.from({ length: count }, (_, i) => {
                const particleSeed = seed + stone.index * 13 + i;
                const angle = (i / count) * Math.PI * 2 + noise(particleSeed) * 0.6;
                return { dx: Math.cos(angle), dy: Math.sin(angle), reach: 0.8 + noise(particleSeed + 1) * 0.2 };
            });
            this.stones.set(stone.index, { ...stone, appearance: { alpha: 1, scale: 1 }, sparks });
        }
        this.connections = plan.connections.map(({ from, to }) => {
            const source = this.stones.get(from)!;
            return {
                from: source,
                to: this.stones.get(to)!,
                bolt: new LightningBolt(seed + to, source.strength),
                branch: source.strength > 0 ? new LightningBolt(to, 0) : null,
                branchSide: noise(seed + to) > 0 ? 1 : -1,
            };
        });
    }

    advance(dtMs: number): boolean {
        this.progress = clamp(this.progress + dtMs / CONNECTION_DURATION_MS);
        return this.progress >= 1;
    }

    /** Borrowed per-stone state, updated in place instead of allocated each frame. */
    appearance(index: number, reduced: boolean): Readonly<{ alpha: number; scale: number }> | null {
        const stone = this.stones.get(index);
        if (!stone) return null;
        const appearance = stone.appearance;
        if (reduced) {
            appearance.alpha = 1 - this.progress;
            appearance.scale = 1;
        } else {
            const local = clamp((this.progress - stone.arrival) / 0.62);
            const dissolve = clamp((local - 0.18) / 0.72);
            appearance.alpha = 1 - dissolve;
            appearance.scale = (1 + Math.sin(local * Math.PI) * 0.08) * (1 - dissolve * 0.85);
        }
        return appearance;
    }

    draw(
        ctx: CanvasRenderingContext2D,
        centers: readonly (Point | null)[],
        radius: number,
        reduced: boolean,
        sprites: ConnectionSprites,
    ) {
        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        if (!reduced) {
            for (const connection of this.connections) {
                const { from, to } = connection;
                const age = this.progress - from.arrival;
                if (age < 0 || age > 0.52) continue;
                const a = centers[from.index]!;
                const b = centers[to.index]!;
                const reveal = clamp(age / Math.max(0.04, to.arrival - from.arrival));
                this.end.x = a.x + (b.x - a.x) * reveal;
                this.end.y = a.y + (b.y - a.y) * reveal;
                const points = connection.bolt.update(a, this.end, this.progress);
                const alpha = clamp(age / 0.045) * clamp((0.52 - age) / 0.2);
                const color = sprites.get(from.color).color;
                this.strokeBolt(ctx, points, color, radius, from.strength, alpha);
                if (connection.branch && reveal > 0.5) {
                    const branch = points[4];
                    const side = connection.branchSide;
                    this.tip.x = branch.x + (b.x - a.x) * 0.18 - (b.y - a.y) * side * (0.12 + from.strength * 0.2);
                    this.tip.y = branch.y + (b.y - a.y) * 0.18 + (b.x - a.x) * side * (0.12 + from.strength * 0.2);
                    this.strokeBolt(
                        ctx,
                        connection.branch.update(branch, this.tip, this.progress),
                        color,
                        radius * 0.5,
                        0,
                        alpha * from.strength * 0.65,
                    );
                }
            }
        }
        for (const stone of this.stones.values()) {
            const center = centers[stone.index]!;
            const local = reduced ? this.progress : clamp((this.progress - stone.arrival) / 0.62);
            if (local <= 0 || local >= 1) continue;
            const envelope = Math.sin(local * Math.PI);
            const glowRadius = radius * (reduced ? 0.85 : 0.8 + local * (0.7 + stone.strength * 0.5));
            const { color, glow } = sprites.get(stone.color);
            ctx.globalAlpha = envelope * (reduced ? 0.25 : 0.75);
            ctx.drawImage(glow, center.x - glowRadius, center.y - glowRadius, glowRadius * 2, glowRadius * 2);
            if (reduced) continue;
            // Directions and reach are prepared once. Only distance changes.
            const burst = clamp((local - 0.16) / 0.84);
            ctx.globalAlpha = Math.sin(burst * Math.PI) * (1 - burst);
            ctx.strokeStyle = color;
            ctx.lineWidth = Math.max(1, radius * 0.035);
            ctx.beginPath();
            const reach = radius * (0.2 + burst * (0.65 + stone.strength * 0.5));
            const tail = radius * 0.16 * (1 - burst);
            for (const spark of stone.sparks) {
                const distance = reach * spark.reach;
                ctx.moveTo(center.x + spark.dx * distance, center.y + spark.dy * distance);
                ctx.lineTo(center.x + spark.dx * (distance + tail), center.y + spark.dy * (distance + tail));
            }
            ctx.stroke();
        }
        ctx.restore();
    }

    private strokeBolt(
        ctx: CanvasRenderingContext2D,
        points: readonly Point[],
        color: string,
        radius: number,
        strength: number,
        alpha: number,
    ) {
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
        const width = Math.max(1, radius * (0.025 + strength * 0.025));
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha * 0.12;
        ctx.lineWidth = width * 9;
        ctx.stroke();
        ctx.globalAlpha = alpha * 0.5;
        ctx.lineWidth = width * 3;
        ctx.stroke();
        ctx.strokeStyle = "#fff9e9";
        ctx.globalAlpha = alpha;
        ctx.lineWidth = width;
        ctx.stroke();
    }
}
