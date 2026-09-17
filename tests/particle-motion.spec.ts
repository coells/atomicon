import { expect, test } from "@playwright/test";

test("each stone has distinct particle paths, fresh clears vary, and drawing uses no randomness", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
        const effectUrl = "/src/connection-effect.ts";
        const gameUrl = "/src/game.ts";
        const { ConnectionEffect, ConnectionSprites, planConnections }: typeof import("../src/connection-effect") =
            await import(effectUrl);
        const { createEmptyGrid, cellIndex }: typeof import("../src/game") = await import(gameUrl);
        const positions = [
            { row: 0, col: 4 },
            { row: 0, col: 5 },
            { row: 1, col: 4 },
            { row: 2, col: 4 },
            { row: 2, col: 3 },
        ];
        const grid = createEmptyGrid();
        for (const pos of positions) grid[pos.row][pos.col].color = 0;
        const keys = new Set(positions.map(cellIndex));
        const plan = planConnections(keys, grid);
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d")!;
        // Widely separated centers let the drawing boundary identify the emitting
        // stone without inspecting private effect state. Compare in cell-local units.
        const centers = Array.from({ length: 81 }, (_, index) => ({ x: index * 1000, y: 0 }));
        const sprites = new ConnectionSprites(["#ff9a49"]);
        let samples: { index: number; x: number; y: number; spin: number }[] = [];
        sprites.particles.draw = (_ctx, _color, x, y, radius, _progress, motion) => {
            const index = Math.round(x / 1000);
            samples.push({ index, x: (x - centers[index].x) / radius, y: y / radius, spin: motion.spin });
        };
        const capture = (effect: InstanceType<typeof ConnectionEffect>, radius = 20) => {
            const paths = [];
            for (const stone of plan.stones.values()) {
                const path = [];
                for (const age of [0.2, 0.45, 0.7]) {
                    effect.progress = stone.arrival + 0.22 + 0.72 * age;
                    samples = [];
                    effect.draw(ctx, centers, radius, false, sprites);
                    path.push(
                        samples
                            .filter((sample) => sample.index === stone.index)
                            .map(({ x, y, spin }) => [
                                Math.round(x * 1000),
                                Math.round(y * 1000),
                                Math.round(spin * 1000),
                            ]),
                    );
                }
                paths.push(path);
            }
            return paths;
        };
        const random = Math.random;
        let calls = 0;
        let seed = 0.314;
        Math.random = () => {
            calls++;
            return seed;
        };
        try {
            const effect = new ConnectionEffect(keys, grid);
            const first = capture(effect);
            const afterFirst = calls;
            const repeatFrames = capture(effect);
            const resized = capture(effect, 55);
            const afterDrawing = calls;
            const sameSeed = capture(new ConnectionEffect(keys, grid));
            seed = 0.718;
            const fresh = capture(new ConnectionEffect(keys, grid));
            return {
                distinctStones: new Set(first.map((path) => JSON.stringify(path))).size,
                counts: first.map((path) => path.map((frame) => frame.length)),
                repeatable: JSON.stringify(first) === JSON.stringify(repeatFrames),
                scalesWithBoard: JSON.stringify(first) === JSON.stringify(resized),
                sameSeed: JSON.stringify(first) === JSON.stringify(sameSeed),
                freshSeed: JSON.stringify(first) !== JSON.stringify(fresh),
                afterFirst,
                afterDrawing,
            };
        } finally {
            Math.random = random;
        }
    });
    expect(result).toEqual({
        distinctStones: 5,
        counts: Array.from({ length: 5 }, () => [3, 3, 3]),
        repeatable: true,
        scalesWithBoard: true,
        sameSeed: true,
        freshSeed: true,
        afterFirst: 1,
        afterDrawing: 1,
    });
});

test("clear particles stay bounded, end by the afterglow deadline, and disappear in reduced motion", async ({
    page,
}) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
        const effectUrl = "/src/connection-effect.ts";
        const gameUrl = "/src/game.ts";
        const {
            ConnectionEffect,
            ConnectionSprites,
            CONNECTION_DURATION_MS,
        }: typeof import("../src/connection-effect") = await import(effectUrl);
        const { ALL_VALID_POSITIONS, createEmptyGrid, cellIndex }: typeof import("../src/game") = await import(gameUrl);
        const ctx = document.createElement("canvas").getContext("2d")!;
        const centers = Array.from({ length: 81 }, (_, index) => ({ x: index * 1000, y: 0 }));
        const sprites = new ConnectionSprites(["#ff9a49"]);
        let drawn = 0;
        let finiteAndLocal = true;
        sprites.particles.draw = (_ctx, _color, x, y) => {
            drawn++;
            const origin = Math.round(x / 1000) * 1000;
            finiteAndLocal &&=
                Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - origin) < 40 && Math.abs(y) < 40;
        };
        const results = [];
        for (const count of [5, 8, 12, 60]) {
            const grid = createEmptyGrid();
            const positions = ALL_VALID_POSITIONS.slice(0, count);
            for (const pos of positions) grid[pos.row][pos.col].color = 0;
            const effect = new ConnectionEffect(new Set(positions.map(cellIndex)), grid);
            let maximum = 0;
            for (let elapsed = 0; elapsed < 1100; elapsed += 1000 / 30) {
                drawn = 0;
                effect.draw(ctx, centers, 20, false, sprites);
                maximum = Math.max(maximum, drawn);
                effect.advance(1000 / 30);
            }
            drawn = 0;
            effect.draw(ctx, centers, 20, false, sprites);
            const afterEnd = drawn;
            effect.progress = 0.55;
            effect.draw(ctx, centers, 20, true, sprites);
            const reduced = drawn;
            effect.advance(CONNECTION_DURATION_MS * 2);
            results.push({ count, maximum, afterEnd, reduced, finished: effect.finished });
        }
        return { results, finiteAndLocal };
    });
    expect(result.finiteAndLocal).toBe(true);
    for (const entry of result.results) {
        expect(entry.maximum).toBeGreaterThan(0);
        expect(entry.maximum).toBeLessThanOrEqual(96);
        expect(entry.afterEnd).toBe(0);
        expect(entry.reduced).toBe(0);
        expect(entry.finished).toBe(true);
    }
});
