import { expect, test } from "@playwright/test";
import type { FrameLoop } from "../src/frame-loop";

declare global {
    interface Window {
        frameLoopTest: {
            loop: FrameLoop;
            paints: number;
            callbacks: number;
            active: boolean;
            invalidateDuringPaint: boolean;
        };
    }
}

for (const refreshHz of [60, 120]) {
    test(`30 Hz animation cadence without display-rate polling on a ${refreshHz} Hz screen`, async ({ page }) => {
        await page.clock.install();
        await page.goto("/");
        await page.clock.runFor(1000);
        await page.evaluate(async (hz) => {
            const moduleUrl = "/src/frame-loop.ts";
            const { FrameLoop }: typeof import("../src/frame-loop") = await import(moduleUrl);
            // Emulate display refresh independently of Playwright's fixed rAF clock.
            window.requestAnimationFrame = (callback) => {
                const now = performance.now();
                const frameTime = ((Math.floor(now / (1000 / hz)) + 1) * 1000) / hz;
                return window.setTimeout(
                    () => {
                        window.frameLoopTest.callbacks++;
                        callback(frameTime);
                    },
                    Math.max(1, frameTime - now),
                );
            };
            window.cancelAnimationFrame = (id) => window.clearTimeout(id);
            const loop = new FrameLoop(() => {
                const state = window.frameLoopTest;
                state.paints++;
                if (state.invalidateDuringPaint) {
                    state.invalidateDuringPaint = false;
                    loop.request();
                }
                return state.active;
            });
            window.frameLoopTest = { loop, paints: 0, callbacks: 0, active: true, invalidateDuringPaint: false };
            loop.request();
        }, refreshHz);
        await page.clock.runFor(1000);
        const counts = () =>
            page.evaluate(() => ({ paints: window.frameLoopTest.paints, callbacks: window.frameLoopTest.callbacks }));
        const active = await counts();
        expect(active.paints).toBeGreaterThanOrEqual(28);
        expect(active.paints).toBeLessThanOrEqual(32);
        expect(active.callbacks).toBe(active.paints);

        // Pause with a delayed frame pending: neither timers nor rAF may paint.
        await page.evaluate(() => window.frameLoopTest.loop.setPaused(true));
        await page.clock.runFor(10000);
        expect(await counts()).toEqual(active);
        await page.evaluate(() => {
            const state = window.frameLoopTest;
            state.active = false;
            state.loop.setPaused(false);
            state.loop.setPaused(true); // also cancel an already queued rAF
        });
        await page.clock.runFor(1000);
        expect(await counts()).toEqual(active);

        // A burst of invalidations coalesces, and an invalidation during paint
        // survives even when the animation itself says it has finished.
        await page.evaluate(() => {
            const state = window.frameLoopTest;
            state.invalidateDuringPaint = true;
            state.loop.setPaused(false);
            for (let i = 0; i < 100; i++) state.loop.request();
        });
        await page.clock.runFor(100);
        const settled = await counts();
        expect(settled.paints - active.paints).toBe(2);
        expect(settled.callbacks).toBe(settled.paints);
        await page.clock.runFor(10000);
        expect(await counts()).toEqual(settled);

        await page.evaluate(() => window.frameLoopTest.loop.request());
        await page.clock.runFor(20);
        expect((await counts()).paints).toBe(settled.paints + 1);
    });
}
