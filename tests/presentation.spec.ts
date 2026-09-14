import { expect, test } from "@playwright/test";

declare global {
    interface Window {
        testFrames: number;
        testPaints: number;
    }
}

test("phone board fills available width, controls fit, and assets stay local", async ({ page }, testInfo) => {
    const external: string[] = [];
    page.on("request", (request) => {
        if (request.url().startsWith("http") && !request.url().startsWith("http://127.0.0.1:4173"))
            external.push(request.url());
    });
    await page.goto("/");
    await expect(page.locator("#game-canvas")).toHaveAttribute("aria-busy", "false");
    await page.locator(".next-dot").evaluateAll((dots) => dots.forEach((dot) => dot.classList.remove("hidden")));
    for (const [width, height] of [
        [320, 568],
        [375, 667],
        [390, 844],
        [430, 932],
        [844, 390],
    ]) {
        await page.setViewportSize({ width, height });
        await expect
            .poll(async () => {
                const box = await page.locator("#game-canvas").boundingBox();
                return Math.round(box?.width ?? 0);
            })
            .toBe(width < height ? width : height - 128);
        expect(
            await page.evaluate(
                () =>
                    document.documentElement.scrollWidth <= innerWidth &&
                    document.documentElement.scrollHeight <= innerHeight,
            ),
        ).toBe(true);
        const controls = await page.locator(".controls").boundingBox();
        expect(controls!.y + controls!.height).toBeLessThanOrEqual(height);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
        .poll(() =>
            page.locator("#game-canvas").evaluate((canvas) => {
                if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Missing canvas");
                const alpha = canvas.getContext("2d")!.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data[3];
                return alpha > 0 ? canvas.width / Math.min(devicePixelRatio, 2) : 0;
            }),
        )
        .toBe(390);
    await page.screenshot({ path: testInfo.outputPath("mobile.png") });
    expect(external).toEqual([]);
    expect(await page.locator("body").innerText()).not.toContain("little");
});

test("settings and restart stay above the toolbar without a modal or focus trap", async ({ page }) => {
    await page.goto("/");
    await page.locator("#settings-toggle").click();
    await page.locator("#reduce-motion").check();
    await page.locator("#mute-audio").check();
    await expect(page.locator("#help-btn")).toHaveCount(0);
    const panel = await page.locator("#settings-panel").boundingBox();
    const toggle = await page.locator("#settings-toggle").boundingBox();
    expect(panel!.y + panel!.height).toBeLessThanOrEqual(toggle!.y);
    await page.locator("#new-game-btn").click();
    await expect(page.locator("#restart-confirm")).toBeVisible();
    await page.locator("#cancel-restart-btn").click();
    await expect(page.locator("#restart-confirm")).not.toBeVisible();
    expect(await page.locator("dialog, [aria-modal=true]").count()).toBe(0);
    await page.reload();
    await expect(page.locator("body")).toHaveClass(/reduced-motion/);
    await expect(page.locator("#sound-toggle")).toHaveAttribute("aria-pressed", "true");
});

for (const reducedMotion of ["reduce", "no-preference"] as const) {
    test(`idle painting is capped and background activity stops (${reducedMotion})`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion });
        await page.clock.install();
        await page.addInitScript(() => {
            window.testFrames = 0;
            window.testPaints = 0;
            Math.random = () => 0.5;
            const raf = window.requestAnimationFrame.bind(window);
            window.requestAnimationFrame = (callback) =>
                raf((time) => {
                    window.testFrames++;
                    callback(time);
                });
            const clear = CanvasRenderingContext2D.prototype.clearRect;
            CanvasRenderingContext2D.prototype.clearRect = function (...args) {
                if (this.canvas.id === "game-canvas") window.testPaints++;
                clear.apply(this, args);
            };
        });
        await page.goto("/");
        await page.clock.runFor(1200);
        await expect(page.locator("#space-count")).toHaveText("54");
        await expect(page.locator("#score")).toHaveText("0");
        // Fixed deal puts a creature at row 4, column 5: select via keyboard.
        await page.locator("#game-canvas").focus();
        await page.locator("#game-canvas").evaluate((canvas) => {
            const box = canvas.getBoundingClientRect();
            const radius = (box.width - Math.min(3, box.width * 0.068) * 2) / (Math.sqrt(3) * 8 + 2.2);
            canvas.dispatchEvent(
                new MouseEvent("click", {
                    bubbles: true,
                    clientX: box.x + box.width / 2 + Math.sqrt(3) * radius,
                    clientY: box.y + box.height / 2,
                }),
            );
        });
        await expect(page.locator("#message")).toContainText("Sun selected");
        await page.clock.runFor(300);
        const counts = () => page.evaluate(() => [window.testFrames, window.testPaints]);
        const before = await counts();
        await page.clock.runFor(10000);
        const after = await counts();
        if (reducedMotion === "reduce") {
            expect(after).toEqual(before);
            expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
        } else {
            expect(after[1] - before[1]).toBeGreaterThan(0);
            expect(after[1] - before[1]).toBeLessThanOrEqual(205);
        }
        const hidden = await page.evaluate(() => {
            Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
            document.dispatchEvent(new Event("visibilitychange"));
            // Snapshot atomically with hiding: a visible frame may legitimately
            // run between separate browser calls, especially in WebKit.
            return [window.testFrames, window.testPaints];
        });
        await page.clock.runFor(10000);
        expect(await counts()).toEqual(hidden);
        expect(
            await page.evaluate(() => document.getAnimations().every((animation) => animation.playState === "paused")),
        ).toBe(true);
    });
}
