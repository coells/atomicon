import { ElementParticles, type ParticleMotion } from "./element-particles";
import { cellIndex, GRID_SIZE, JOKER_COLOR, MIN_MATCH, type Grid, type Position } from "./game";

export const CONNECTION_DURATION_MS = 620;
// The last part is decoration only; the next move need not wait for it.
const AFTERGLOW_END = 1.6;

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
    readonly particles = new ElementParticles();

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

interface ClearAppearance {
    alpha: number;
    scale: number;
    stretch: number;
    lift: number;
}

interface ClearParticle {
    trajectory: { start: Point; linear: Point; quadratic: Point; cubic: Point };
    pace: number;
    delay: number;
    motion: ParticleMotion;
}

/** Prepare cubic Bézier coefficients once; drawing needs only multiply/add operations. */
function particleTrajectory(start: Point, first: Point, second: Point, end: Point): ClearParticle["trajectory"] {
    return {
        start,
        linear: { x: 3 * (first.x - start.x), y: 3 * (first.y - start.y) },
        quadratic: {
            x: 3 * (second.x - 2 * first.x + start.x),
            y: 3 * (second.y - 2 * first.y + start.y),
        },
        cubic: {
            x: end.x - 3 * second.x + 3 * first.x - start.x,
            y: end.y - 3 * second.y + 3 * first.y - start.y,
        },
    };
}

interface StoneVisual extends ChargedStone {
    appearance: ClearAppearance;
    sparks: ClearParticle[];
}

interface ConnectionVisual {
    from: StoneVisual;
    to: StoneVisual;
    bolt: LightningBolt;
    branch: LightningBolt | null;
    branchSide: number;
}

/** One bounded charge → bounce → dissolve, followed by a non-blocking afterglow. */
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
            // Each creature gets its own drift, not a rotated copy of an evenly
            // spaced burst. Individual particles have independent start/end headings
            // and curve controls; some peel sideways while others curl or float out.
            const stoneSeed = seed + stone.index * 397;
            const driftAngle = noise(stoneSeed) * Math.PI;
            const driftLength = 0.25 + noise(stoneSeed + 1) * 0.12;
            const drift = { x: Math.cos(driftAngle) * driftLength, y: Math.sin(driftAngle) * driftLength };
            const riseBias = 0.8 + noise(stoneSeed + 2) * 0.4;
            const sparks: ClearParticle[] = Array.from({ length: count }, (_, i) => {
                const particleSeed = stoneSeed + (i + 1) * 37;
                const startAngle = noise(particleSeed) * Math.PI;
                const startRadius = 0.18 + noise(particleSeed + 1) * 0.08;
                const start = { x: Math.cos(startAngle) * startRadius, y: Math.sin(startAngle) * startRadius };
                const launchAngle = noise(particleSeed + 2) * Math.PI;
                const launchLength = 0.35 + noise(particleSeed + 3) * 0.15;
                const first = {
                    x: start.x + Math.cos(launchAngle) * launchLength + drift.x,
                    y: start.y + Math.sin(launchAngle) * launchLength + drift.y,
                };
                const endAngle = noise(particleSeed + 4) * Math.PI;
                const reach = 0.45 + noise(particleSeed + 5) * 0.2;
                const curl = noise(particleSeed + 6) * 0.45;
                const dx = Math.cos(endAngle);
                const dy = Math.sin(endAngle);
                const end = { x: drift.x + dx * reach, y: drift.y + dy * reach };
                const second = {
                    x: end.x - dx * reach * 0.3 - dy * curl,
                    y: end.y - dy * reach * 0.3 + dx * curl,
                };
                return {
                    trajectory: particleTrajectory(start, first, second, end),
                    // Both slow departures and quicker departures; all still end on time.
                    pace: noise(particleSeed + 7) * 0.7,
                    delay: (noise(particleSeed + 8) + 1) * 0.035,
                    motion: {
                        phase: noise(particleSeed + 9) * Math.PI,
                        spin: (noise(particleSeed + 10) > 0 ? 1 : -1) * (1.2 + noise(particleSeed + 11) * 0.6),
                        rise: riseBias * (1 + noise(particleSeed + 12) * 0.2),
                        flutter: 1 + noise(particleSeed + 13) * 0.4,
                        flutterRate: 1.4 + noise(particleSeed + 14) * 0.4,
                    },
                };
            });
            this.stones.set(stone.index, {
                ...stone,
                appearance: { alpha: 1, scale: 1, stretch: 1, lift: 0 },
                sparks,
            });
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
        this.progress = Math.min(AFTERGLOW_END, this.progress + Math.max(0, dtMs) / CONNECTION_DURATION_MS);
        return this.progress >= 1;
    }

    get finished(): boolean {
        return this.progress >= AFTERGLOW_END;
    }

    /** Borrowed per-stone state, updated in place instead of allocated each frame. */
    appearance(index: number, reduced: boolean): Readonly<ClearAppearance> | null {
        const stone = this.stones.get(index);
        if (!stone) return null;
        const appearance = stone.appearance;
        if (reduced) {
            appearance.alpha = 1 - clamp(this.progress);
            appearance.scale = 1;
            appearance.stretch = 1;
            appearance.lift = 0;
        } else {
            const local = clamp((this.progress - stone.arrival) / 0.62);
            const crouch = Math.sin(clamp(local / 0.22) * Math.PI);
            const hop = Math.sin(clamp((local - 0.16) / 0.5) * Math.PI);
            const fade = clamp((local - 0.36) / 0.64);
            const dissolve = fade * fade * (3 - 2 * fade);
            appearance.alpha = 1 - dissolve;
            appearance.scale = 1 - dissolve * 0.3;
            appearance.stretch = 1 - crouch * 0.07 + hop * 0.045;
            appearance.lift = hop * 0.07;
        }
        return appearance;
    }

    /** Paint beneath creatures so a lingering glow never obscures a new arrival. */
    drawGlow(
        ctx: CanvasRenderingContext2D,
        centers: readonly (Point | null)[],
        radius: number,
        reduced: boolean,
        sprites: ConnectionSprites,
    ) {
        ctx.save();
        for (const stone of this.stones.values()) {
            const age = this.progress - (reduced ? 0 : stone.arrival);
            if (age <= 0) continue;
            const envelope = reduced
                ? Math.sin(clamp(this.progress) * Math.PI) * 0.25
                : clamp(age / 0.2) * clamp((AFTERGLOW_END - this.progress) / 0.85) * 0.6;
            if (envelope <= 0) continue;
            const center = centers[stone.index]!;
            const { color, glow } = sprites.get(stone.color);
            const size = radius * 1.05;
            ctx.globalAlpha = envelope;
            ctx.drawImage(glow, center.x - size, center.y - size, size * 2, size * 2);
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
                const angle = ((60 * i - 30) * Math.PI) / 180;
                const x = center.x + Math.cos(angle) * radius * 0.9;
                const y = center.y + Math.sin(angle) * radius * 0.9;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.strokeStyle = color;
            ctx.globalAlpha = envelope * 0.35;
            ctx.lineWidth = Math.max(0.7, radius * 0.018);
            ctx.stroke();
        }
        ctx.restore();
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
            if (reduced) break;
            const center = centers[stone.index]!;
            // Motes emerge as the sprite fades, then drift rather than shoot outward.
            const age = this.progress - stone.arrival - 0.22;
            if (age <= 0 || age >= 0.72) continue;
            for (const spark of stone.sparks) {
                // A small stagger, but every particle still ends at the same deadline.
                // No additional wakeups, particles, or per-frame random samples.
                const burst = clamp((age - spark.delay) / (0.72 - spark.delay));
                if (burst <= 0 || burst >= 1) continue;
                ctx.globalAlpha = clamp(burst / 0.16) * clamp((1 - burst) / 0.55) * 0.85;
                const travel = burst + burst * (1 - burst) * spark.pace;
                const { start, linear, quadratic, cubic } = spark.trajectory;
                const x = ((cubic.x * travel + quadratic.x) * travel + linear.x) * travel + start.x;
                const y = ((cubic.y * travel + quadratic.y) * travel + linear.y) * travel + start.y;
                sprites.particles.draw(
                    ctx,
                    stone.color,
                    center.x + radius * x,
                    center.y + radius * y,
                    radius,
                    burst,
                    spark.motion,
                );
            }
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
