import { expect, test } from "@playwright/test";
import { ConnectionEffect, CONNECTION_DURATION_MS, LightningBolt, planConnections } from "../src/connection-effect";
import { ALL_VALID_POSITIONS, cellIndex, checkLines, createEmptyGrid, GRID_SIZE, JOKER_COLOR } from "../src/game";
import type { Renderer } from "../src/renderer";

const bent = [
    { row: 0, col: 4 },
    { row: 0, col: 5 },
    { row: 1, col: 4 },
    { row: 2, col: 4 },
    { row: 2, col: 3 },
];

function fixture(positions = bent) {
    const grid = createEmptyGrid();
    for (const pos of positions) grid[pos.row][pos.col].color = 1;
    return { grid, positions: new Set(positions.map(cellIndex)) };
}

test("lightning follows a bent group outward from the moved stone, including jokers", () => {
    const { grid, positions } = fixture();
    grid[1][4].color = JOKER_COLOR;
    const origin = bent[4];
    const plan = planConnections(checkLines(grid).toRemove, grid, origin);
    expect(plan.stones.size).toBe(positions.size);
    expect(plan.connections).toHaveLength(positions.size - 1);
    expect(plan.stones.get(cellIndex(origin))?.arrival).toBe(0);
    for (const edge of plan.connections) {
        const dr = Math.floor(edge.to / GRID_SIZE) - Math.floor(edge.from / GRID_SIZE);
        const dc = (edge.to % GRID_SIZE) - (edge.from % GRID_SIZE);
        expect(Math.max(Math.abs(dr), Math.abs(dc), Math.abs(dr + dc))).toBe(1);
        expect(plan.stones.get(edge.to)!.arrival).toBeGreaterThan(plan.stones.get(edge.from)!.arrival);
    }
    const effect = new ConnectionEffect(positions, grid, origin);
    effect.advance(CONNECTION_DURATION_MS * 0.3);
    expect(effect.appearance(cellIndex(origin), false)!.alpha).toBeLessThan(1);
    expect(effect.appearance(cellIndex(bent[1]), false)!.alpha).toBe(1);
    expect(effect.appearance(cellIndex({ row: 8, col: 4 }), false)).toBeNull();
});

test("simultaneous groups do not arc across gaps or between touching unrelated colors", () => {
    const { grid, positions } = fixture();
    const other = [
        { row: 1, col: 5 },
        { row: 1, col: 6 },
        { row: 1, col: 7 },
        { row: 2, col: 6 },
        { row: 2, col: 5 },
    ];
    for (const pos of other) {
        grid[pos.row][pos.col].color = 0;
        positions.add(cellIndex(pos));
    }
    grid[8][0].color = 1;
    positions.add(cellIndex({ row: 8, col: 0 }));
    const plan = planConnections(positions, grid);
    expect(plan.connections).toHaveLength(8);
    for (const edge of plan.connections) {
        expect(plan.stones.get(edge.from)!.color).toBe(plan.stones.get(edge.to)!.color);
    }
    expect([...plan.stones.values()].every((stone) => stone.strength === 0)).toBe(true);
});

test("larger groups increase intensity up to a cap, never duration", () => {
    let previous = -1;
    for (const count of [5, 8, 12, 60]) {
        const { grid, positions } = fixture(ALL_VALID_POSITIONS.slice(0, count));
        const plan = planConnections(positions, grid);
        const strength = [...plan.stones.values()][0].strength;
        expect(strength).toBeGreaterThanOrEqual(previous);
        expect(strength).toBeLessThanOrEqual(1);
        expect(plan.connections).toHaveLength(count - 1);
        previous = strength;
        const effect = new ConnectionEffect(positions, grid);
        expect(effect.advance(CONNECTION_DURATION_MS - 1)).toBe(false);
        expect(effect.advance(1)).toBe(true);
        for (const index of positions) expect(effect.appearance(index, false)?.alpha).toBe(0);
    }
    expect(previous).toBe(1);
});

test("reduced motion fades all stones together without scaling; progress is frame-rate independent", () => {
    const { grid, positions } = fixture();
    const slow = new ConnectionEffect(positions, grid);
    const fast = new ConnectionEffect(positions, grid);
    slow.advance(230);
    for (let i = 0; i < 10; i++) fast.advance(23);
    expect(slow.progress).toBeCloseTo(fast.progress);
    for (const index of positions) {
        const appearance = slow.appearance(index, true);
        expect(appearance).toEqual({ alpha: 0.5, scale: 1 });
        expect(slow.appearance(index, false)).toBe(appearance);
    }
});

test("procedural bolts have stable endpoints, varying interiors, and scale with the board", () => {
    const a = { x: 10, y: 30 },
        b = { x: 90, y: 60 };
    const bolt = new LightningBolt(42, 0.5);
    const path = bolt.update(a, b, 0.3);
    expect(path[0]).toEqual(a);
    expect(path[path.length - 1]).toEqual(b);
    expect(path).toEqual(new LightningBolt(42, 0.5).update(a, b, 0.3));
    expect(path).not.toEqual(new LightningBolt(43, 0.5).update(a, b, 0.3));
    expect(path).not.toEqual(new LightningBolt(42, 0.5).update(a, b, 0.4));
    const scaled = new LightningBolt(42, 0.5).update({ x: a.x * 2, y: a.y * 2 }, { x: b.x * 2, y: b.y * 2 }, 0.3);
    scaled.forEach((point, i) => {
        expect(point.x).toBeCloseTo(path[i].x * 2);
        expect(point.y).toBeCloseTo(path[i].y * 2);
    });
    const references = [...path];
    for (let i = 0; i < 30; i++) {
        expect(bolt.update(a, b, i / 30)).toBe(path);
        path.forEach((point, index) => expect(point).toBe(references[index]));
    }
    expect(bolt.update(a, a, 0).every((point) => point.x === a.x && point.y === a.y)).toBe(true);
});

test("glow sprites are reused across clears, resize, and reduced-motion changes", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
        const effectUrl = "/src/connection-effect.ts";
        const gameUrl = "/src/game.ts";
        const { ConnectionEffect, ConnectionSprites }: typeof import("../src/connection-effect") = await import(
            effectUrl
        );
        const { ALL_VALID_POSITIONS, createEmptyGrid, cellIndex }: typeof import("../src/game") = await import(gameUrl);
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d")!;
        const palette = ["#f36e7d", "#60a5f5", "#88cd72", "#eda653", "#ad8de8", "#ef92c6", "#edcb8e", "#ffd86b"];
        const sprites = new ConnectionSprites(palette);
        const grid = createEmptyGrid();
        const positions = new Set(ALL_VALID_POSITIONS.map(cellIndex));
        for (const pos of ALL_VALID_POSITIONS) grid[pos.row][pos.col].color = 1;
        const gradient = CanvasRenderingContext2D.prototype.createRadialGradient;
        let gradients = 0;
        CanvasRenderingContext2D.prototype.createRadialGradient = function (...args) {
            gradients++;
            return gradient.apply(this, args);
        };
        try {
            const cached = palette.map((_, index) => sprites.get(index));
            for (const size of [320, 430, 1365]) {
                canvas.width = canvas.height = size;
                const centers = Array.from({ length: 81 }, (_, index) => ({
                    x: ((index % 9) * size) / 9,
                    y: (Math.floor(index / 9) * size) / 9,
                }));
                const effect = new ConnectionEffect(positions, grid);
                for (let frame = 0; frame < 15; frame++) {
                    effect.advance(1000 / 30);
                    effect.draw(ctx, centers, size / 16, frame > 7, sprites);
                }
            }
            return { gradients, reused: cached.every((sprite, index) => sprite === sprites.get(index)) };
        } finally {
            CanvasRenderingContext2D.prototype.createRadialGradient = gradient;
        }
    });
    expect(result).toEqual({ gradients: 8, reused: true });
});

declare global {
    interface Window {
        connectionTest: {
            renderer: Renderer;
            grid: ReturnType<typeof createEmptyGrid>;
            positions: Set<number>;
            now: number;
            completed: number;
        };
    }
}

for (const reduced of [false, true]) {
    test(`clear rendering, resize, and reset leave no lingering effects (reduced=${reduced})`, async ({
        page,
    }, testInfo) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto("/");
        const drawing = await page.evaluate(
            async ({ shape, reduced }) => {
                // Exercise the public renderer API on its own canvas, without a game-state backdoor.
                const rendererUrl = "/src/renderer.ts";
                const gameUrl = "/src/game.ts";
                const { Renderer }: typeof import("../src/renderer") = await import(rendererUrl);
                const { createEmptyGrid, cellIndex }: typeof import("../src/game") = await import(gameUrl);
                const canvas = document.createElement("canvas");
                canvas.id = "connection-preview";
                document.getElementById("board-wrap")!.replaceChildren(canvas);
                const renderer = new Renderer(canvas);
                const grid = createEmptyGrid();
                const positions = new Set(shape.map(cellIndex));
                for (const pos of shape) grid[pos.row][pos.col].color = 1;
                grid[2][4].color = 7;
                await new Promise<void>((resolve) => {
                    renderer.onInvalidate = resolve;
                });
                renderer.onInvalidate = null;
                renderer.setReducedMotion(reduced);
                window.connectionTest = { renderer, grid, positions, now: 1000, completed: 0 };
                renderer.onAnimationComplete = () => window.connectionTest.completed++;
                const ctx = canvas.getContext("2d")!;
                const stroke = ctx.stroke.bind(ctx);
                const gradient = ctx.createRadialGradient.bind(ctx);
                let boardGradients = 0;
                ctx.createRadialGradient = (...args) => {
                    boardGradients++;
                    return gradient(...args);
                };
                let bolts = 0;
                ctx.stroke = () => {
                    if (ctx.strokeStyle === "#fff9e9") bolts++;
                    stroke();
                };
                renderer.startRemoveAnimation(positions, grid, shape[shape.length - 1]);
                for (let i = 0; i < 6; i++) {
                    renderer.draw(grid, window.connectionTest.now);
                    window.connectionTest.now += 1000 / 30;
                }
                return { bolts, boardGradients };
            },
            { shape: [...bent, { row: 1, col: 5 }, { row: 2, col: 5 }, { row: 3, col: 4 }], reduced },
        );
        if (reduced) expect(drawing.bolts).toBe(0);
        else expect(drawing.bolts).toBeGreaterThan(0);
        expect(drawing.boardGradients).toBe(0);
        await expect(page.locator("#connection-preview")).toHaveAttribute("aria-busy", "true");
        await page.screenshot({ path: testInfo.outputPath(reduced ? "gentle-clear.png" : "lightning-clear.png") });
        await page.setViewportSize({ width: 430, height: 932 });
        const finished = await page.evaluate(() => {
            const state = window.connectionTest;
            state.renderer.resize();
            for (let i = 0; i < 15; i++) {
                state.renderer.draw(state.grid, state.now);
                state.now += 1000 / 30;
            }
            return { completed: state.completed, busy: state.renderer.isBusy() };
        });
        expect(finished).toEqual({ completed: 1, busy: false });
        await expect(page.locator("#connection-preview")).toHaveAttribute("aria-busy", "false");
        const reset = await page.evaluate(() => {
            const state = window.connectionTest;
            state.renderer.startRemoveAnimation(state.positions, state.grid);
            state.renderer.draw(state.grid, (state.now += 10000)); // time at rest must not advance a new clear
            for (let i = 0; i < 11; i++) state.renderer.draw(state.grid, (state.now += 33));
            state.renderer.resetClock(); // same clock reset used when hiding/resuming the page
            state.renderer.draw(state.grid, (state.now += 10000));
            state.renderer.draw(state.grid, (state.now += 33));
            const activeBeforeReset = state.renderer.isBusy();
            state.renderer.setReducedMotion(true);
            state.renderer.reset();
            for (let i = 0; i < 20; i++) state.renderer.draw(state.grid, (state.now += 33));
            return { completed: state.completed, busy: state.renderer.isBusy(), activeBeforeReset };
        });
        expect(reset).toEqual({ completed: 1, busy: false, activeBeforeReset: true });
        expect(errors).toEqual([]);
    });
}
