import { expect, test, type Page } from "@playwright/test";
import { ALL_VALID_POSITIONS, type Position } from "../src/game";

// Control only the deal. The match itself is made with two real touch taps.
const initialPositions: Position[] = [
    { row: 0, col: 4 },
    { row: 0, col: 5 },
    { row: 0, col: 6 },
    { row: 0, col: 7 },
    { row: 8, col: 0 },
    { row: 8, col: 4 },
];
const remaining = [...ALL_VALID_POSITIONS];
const deal = [2, 3, 4, 2, 3, 0, 0, 0, 0, 0, 1].flatMap((color) => [0.5, (color + 0.1) / 7]);
for (const pos of initialPositions) {
    const index = remaining.findIndex((candidate) => candidate.row === pos.row && candidate.col === pos.col);
    deal.push((index + 0.1) / remaining.length);
    remaining.splice(index, 1);
}

async function tap(page: Page, pos: Position) {
    const canvas = page.locator("#game-canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("Missing board");
    const radius = (box.width - 6) / (Math.sqrt(3) * 8 + 2.2);
    await canvas.tap({
        position: {
            x: box.width / 2 + Math.sqrt(3) * (pos.col - 4 + (pos.row - 4) / 2) * radius,
            y: box.height / 2 + 1.5 * (pos.row - 4) * radius,
        },
    });
}

declare global {
    interface Window {
        touchFeedback: {
            paints: number;
            pointerMoves: number;
            particles: number;
            maxReadablePixels: number;
            minReadableDiameter: number;
            readableFrames: number;
            lastReadablePaint: number;
            blockedOpacity: number[];
            routePaints: number;
            poses: { a: number; d: number; angle: number }[];
        };
    }
}

test.use({ hasTouch: true });
test.beforeEach(async ({ page }) => {
    let particleUrl: string | undefined;
    page.on("request", (request) => {
        if (new URL(request.url()).pathname === "/src/element-particles.ts") particleUrl = request.url();
    });
    await page.clock.install();
    await page.addInitScript((values) => {
        let index = 0;
        Math.random = () => values[index++] ?? 0.5;
        localStorage.setItem(
            "atomicon_preferences",
            JSON.stringify({ muted: true, reducedMotion: false, music: 0, effects: 0 }),
        );
    }, deal);
    await page.goto("/");
    await page.clock.pauseAt(Date.now() + 1000);
    await page.clock.runFor(1000);
    await expect(page.locator("#game-canvas")).toHaveAttribute("aria-busy", "false");
    if (!particleUrl) throw new Error("Particle module was not loaded");
    await page.evaluate(async (url) => {
        window.touchFeedback = {
            paints: 0,
            pointerMoves: 0,
            particles: 0,
            maxReadablePixels: 0,
            minReadableDiameter: Infinity,
            readableFrames: 0,
            lastReadablePaint: -1,
            blockedOpacity: [],
            routePaints: 0,
            poses: [],
        };
        const canvas = document.getElementById("game-canvas");
        if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Missing board canvas");
        canvas.addEventListener("pointermove", () => window.touchFeedback.pointerMoves++);
        const ctx = canvas.getContext("2d")!;
        const clear = ctx.clearRect.bind(ctx);
        ctx.clearRect = (...args) => {
            window.touchFeedback.paints++;
            clear(...args);
        };
        const stroke = ctx.stroke.bind(ctx);
        ctx.stroke = (...args: [path?: Path2D]) => {
            if (ctx.strokeStyle === "#e8b86b") window.touchFeedback.blockedOpacity.push(ctx.globalAlpha);
            if (ctx.strokeStyle === "#dbe7bb") window.touchFeedback.routePaints++;
            Reflect.apply(stroke, ctx, args);
        };
        const drawImage = ctx.drawImage.bind(ctx);
        ctx.drawImage = (...args: [CanvasImageSource, ...number[]]) => {
            const image = args[0];
            if (image instanceof HTMLImageElement && image.src.includes("/characters/")) {
                const matrix = ctx.getTransform();
                const dpr = Math.min(devicePixelRatio, 2);
                // The scripted deal's bottom-left Fire is the only creature here.
                if (matrix.e < canvas.width / 2 && matrix.f > canvas.height * 0.75) {
                    window.touchFeedback.poses.push({
                        a: matrix.a / dpr,
                        d: matrix.d / dpr,
                        angle: Math.atan2(matrix.b, matrix.a),
                    });
                }
            }
            Reflect.apply(drawImage, ctx, args);
        };
        // Vite may timestamp this import after an edit; instrument the same module
        // instance the renderer loaded, not a second copy without its HMR query.
        const { ElementParticles }: typeof import("../src/element-particles") = await import(url);
        const draw = ElementParticles.prototype.draw;
        const probe = document.createElement("canvas");
        probe.width = probe.height = 128;
        const probeCtx = probe.getContext("2d", { willReadFrequently: true })!;
        ElementParticles.prototype.draw = function (context, color, x, y, radius, progress, motion) {
            draw.call(this, context, color, x, y, radius, progress, motion);
            const state = window.touchFeedback;
            state.particles++;
            // Render the same glyph at the real CSS size and alpha, without lightning
            // or creature artwork. Pixels below this alpha are not a readable silhouette.
            probeCtx.clearRect(0, 0, 128, 128);
            probeCtx.globalAlpha = context.globalAlpha;
            draw.call(this, probeCtx, color, 64, 64, radius, progress, motion);
            const pixels = probeCtx.getImageData(0, 0, 128, 128).data;
            let readable = 0;
            let left = 128;
            let right = 0;
            for (let i = 3; i < pixels.length; i += 4) {
                if (pixels[i] < 102) continue;
                readable++;
                const px = ((i - 3) / 4) % 128;
                left = Math.min(left, px);
                right = Math.max(right, px);
            }
            state.maxReadablePixels = Math.max(state.maxReadablePixels, readable);
            if (readable >= 12) {
                state.minReadableDiameter = Math.min(state.minReadableDiameter, right - left + 1);
                if (state.lastReadablePaint !== state.paints) {
                    state.readableFrames++;
                    state.lastReadablePaint = state.paints;
                }
            }
        };
    }, particleUrl);
});

test("touch selection animates briefly without hover, then the canvas sleeps", async ({ page }) => {
    await page.clock.runFor(1000);
    const idle = await page.evaluate(() => ({ ...window.touchFeedback }));
    expect(idle.pointerMoves).toBe(0);
    expect(idle.paints).toBe(0);
    await tap(page, initialPositions[4]);
    await expect(page.locator("#message")).toContainText("Fire selected");
    const before = await page.evaluate(() => window.touchFeedback.paints);
    await page.clock.runFor(1000);
    const selected = await page.evaluate(() => ({ ...window.touchFeedback }));
    expect(selected.pointerMoves).toBe(0);
    expect(selected.paints - before).toBeGreaterThanOrEqual(6);
    expect(selected.paints - before).toBeLessThanOrEqual(16);
    // The fixed cosmetic seed chooses squash/stretch, not uniform enlargement.
    expect(selected.poses.some((pose) => pose.a > 1.02 && pose.d < 0.98)).toBe(true);
    expect(selected.poses.some((pose) => pose.a < 0.98 && pose.d > 1.02)).toBe(true);
    await page.clock.runFor(10000);
    expect(await page.evaluate(() => window.touchFeedback.paints)).toBe(selected.paints);
});

for (const viewport of [
    { name: "phone", width: 390, height: 844 },
    { name: "tablet", width: 820, height: 1180 },
]) {
    test(`a touch-only match paints readable particles on a ${viewport.name}`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await tap(page, initialPositions[4]);
        await expect(page.locator("#message")).toContainText("Fire selected");
        await tap(page, { row: 0, col: 8 });
        await page.clock.runFor(100);
        expect(await page.evaluate(() => window.touchFeedback.routePaints)).toBeGreaterThan(0);
        for (let i = 0; i < 60 && (await page.locator("#score").textContent()) !== "10"; i++) {
            await page.clock.runFor(33);
        }
        await expect(page.locator("#score")).toHaveText("10");
        for (let i = 0; i < 12; i++) {
            await page.clock.runFor(66);
            if ([3, 6, 9].includes(i)) await page.screenshot({ path: testInfo.outputPath(`touch-clear-${i}.png`) });
        }
        const result = await page.evaluate(() => ({ ...window.touchFeedback }));
        await testInfo.attach("touch-feedback.json", {
            body: JSON.stringify(result),
            contentType: "application/json",
        });
        expect(result.pointerMoves).toBe(0);
        expect(result.particles).toBeGreaterThan(0);
        expect(result.maxReadablePixels).toBeGreaterThanOrEqual(12);
        expect(result.readableFrames).toBeGreaterThanOrEqual(6);
        await page.clock.runFor(1000);
        await expect(page.locator("#game-canvas")).toHaveAttribute("aria-busy", "false");
        await expect(page.locator("#space-count")).toHaveText("59");
        const settled = await page.evaluate(() => window.touchFeedback.paints);
        await page.clock.runFor(10000);
        expect(await page.evaluate(() => window.touchFeedback.paints)).toBe(settled);
    });
}

test("blocked touch destinations fade without losing selection or keeping the canvas awake", async ({ page }) => {
    // Move two existing creatures to enclose the top-left Fire, using only taps.
    await tap(page, { row: 0, col: 6 });
    await tap(page, { row: 1, col: 3 });
    await page.clock.runFor(1500);
    await tap(page, { row: 0, col: 7 });
    await tap(page, { row: 1, col: 4 });
    await page.clock.runFor(1500);
    await expect(page.locator("#turn-count")).toHaveText("MOVE 03");
    await tap(page, { row: 0, col: 4 });
    await page.clock.runFor(500);
    await tap(page, { row: 0, col: 6 });
    await expect(page.locator("#message")).toContainText("That path is blocked");
    await expect(page.locator("#game-canvas")).toHaveAttribute("aria-busy", "false");
    await page.clock.runFor(600);
    const faded = await page.evaluate(() => ({ ...window.touchFeedback }));
    expect(faded.blockedOpacity.length).toBeGreaterThanOrEqual(8);
    expect(faded.blockedOpacity[faded.blockedOpacity.length - 1]).toBeLessThan(faded.blockedOpacity[0] / 10);
    expect(faded.pointerMoves).toBe(0);
    await page.clock.runFor(10000);
    expect(await page.evaluate(() => window.touchFeedback.paints)).toBe(faded.paints);
    // Still selected: another empty destination is rejected without reselecting.
    await tap(page, { row: 0, col: 7 });
    await page.clock.runFor(66);
    expect(await page.evaluate(() => window.touchFeedback.blockedOpacity.length)).toBeGreaterThan(
        faded.blockedOpacity.length,
    );
    // Reselect and make a legal move while the glow is still fading.
    await tap(page, { row: 0, col: 5 });
    const cancelled = await page.evaluate(() => window.touchFeedback.blockedOpacity.length);
    await tap(page, { row: 0, col: 6 });
    await page.clock.runFor(1500);
    await expect(page.locator("#turn-count")).toHaveText("MOVE 04");
    expect(await page.evaluate(() => window.touchFeedback.blockedOpacity.length)).toBe(cancelled);
});

test("hidden pages pause a touch pulse and reduced motion does not start one", async ({ page }) => {
    await tap(page, initialPositions[4]);
    await page.clock.runFor(66);
    await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
        document.dispatchEvent(new Event("visibilitychange"));
    });
    const hidden = await page.evaluate(() => window.touchFeedback.paints);
    await page.clock.runFor(10000);
    expect(await page.evaluate(() => window.touchFeedback.paints)).toBe(hidden);
    await page.evaluate(() => {
        Reflect.deleteProperty(document, "hidden");
        document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.clock.runFor(1000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator("#reduce-motion")).toBeChecked();
    await page.clock.runFor(1000);
    const before = await page.evaluate(() => window.touchFeedback.paints);
    await tap(page, initialPositions[5]);
    await expect(page.locator("#message")).toContainText("Ice selected");
    await page.clock.runFor(1000);
    const reduced = await page.evaluate(() => window.touchFeedback.paints);
    expect(reduced - before).toBeLessThanOrEqual(2);
    await page.clock.runFor(10000);
    expect(await page.evaluate(() => window.touchFeedback.paints)).toBe(reduced);
});
