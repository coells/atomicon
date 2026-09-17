import { expect, test, type Locator } from "@playwright/test";

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
            .toBe(width < height ? width : height - 137);
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

test("desktop board uses the available screen and the toolbar stays compact", async ({ page }, testInfo) => {
    await page.goto("/");
    await expect(page.locator("#game-canvas")).toHaveAttribute("aria-busy", "false");
    await page.locator(".next-dot").evaluateAll((dots) => dots.forEach((dot) => dot.classList.remove("hidden")));
    // Mac-sized windows, including the CSS viewport equivalent of 150% zoom.
    for (const [width, height] of [
        [1440, 960],
        [1728, 1117],
        [960, 640],
        [1152, 745],
        [2560, 1440],
        [3000, 2400],
    ]) {
        await page.setViewportSize({ width, height });
        await expect
            .poll(() =>
                page.locator("#game-canvas").evaluate((canvas) => Math.round(canvas.getBoundingClientRect().width)),
            )
            .toBe(Math.min(height - 149, 1365));
        const board = await page.locator("#game-canvas").boundingBox();
        const controls = await page.locator(".controls").boundingBox();
        expect(board!.height).toBeCloseTo(board!.width, 0);
        expect(board!.y + board!.height).toBeLessThanOrEqual(controls!.y);
        expect(controls!.width).toBeLessThanOrEqual(320);
        expect(controls!.height).toBeLessThanOrEqual(64);
        for (const button of await page.locator(".controls > button").all()) {
            const box = await button.boundingBox();
            expect(box!.width).toBeGreaterThanOrEqual(48);
            expect(box!.height).toBeGreaterThanOrEqual(48);
        }
        expect(
            await page.evaluate(
                () =>
                    document.documentElement.scrollWidth <= innerWidth &&
                    document.documentElement.scrollHeight <= innerHeight,
            ),
        ).toBe(true);
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.screenshot({ path: testInfo.outputPath("desktop.png") });
});

test("background fills portrait and landscape screens without stretching", async ({ page }) => {
    await page.goto("/");
    for (const viewport of [
        { width: 390, height: 844 },
        { width: 1440, height: 960 },
        { width: 844, height: 390 },
    ]) {
        await page.setViewportSize(viewport);
        const background = await page.locator("body").evaluate((body) => {
            const style = getComputedStyle(body);
            return { size: style.backgroundSize, position: style.backgroundPosition };
        });
        expect(background.size.split(", ").every((size) => size === "cover")).toBe(true);
        expect(background.position.split(", ").every((position) => position === "50% 50%")).toBe(true);
    }
});

test("top score counters are ten percent larger in portrait and landscape", async ({ page }) => {
    await page.goto("/");
    for (const [width, height, score, best] of [
        [390, 844, 35.2, 28.6],
        [1440, 960, 35.2, 28.6],
        [844, 390, 26.4, 26.4],
    ]) {
        await page.setViewportSize({ width, height });
        expect(
            await page.locator("#score").evaluate((node) => parseFloat(getComputedStyle(node).fontSize)),
        ).toBeCloseTo(score);
        expect(await page.locator("#best").evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeCloseTo(
            best,
        );
    }
});

test("outside taps dismiss both panels without swallowing board input", async ({ page }, testInfo) => {
    await page.addInitScript(() => {
        Math.random = () => 0.5;
    });
    await page.goto("/");
    await expect(page.locator("#game-canvas")).toHaveAttribute("aria-busy", "false");
    const activate = (locator: Locator) => (testInfo.project.use.hasTouch ? locator.tap() : locator.click());
    const settings = page.locator("#settings-panel");
    const toggle = page.locator("#settings-toggle");
    const restart = page.locator("#restart-confirm");
    await activate(toggle);
    await activate(page.locator("#reduce-motion"));
    await page.locator("#music-volume").press("ArrowRight");
    await expect(settings).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await activate(page.locator("#new-game-btn"));
    await expect(restart).toBeVisible();
    await expect(settings).toBeVisible();
    await activate(page.locator(".score"));
    await expect(settings).toBeHidden();
    await expect(restart).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await activate(toggle);
    await activate(page.locator("#new-game-btn"));
    const canvas = page.locator("#game-canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("Board is not visible");
    const radius = (box.width - Math.min(3, box.width * 0.068) * 2) / (Math.sqrt(3) * 8 + 2.2);
    // Select the fixed deal's row 4, column 5 using the still-expanded layout.
    const position = { x: box.width / 2 + Math.sqrt(3) * radius, y: box.height / 2 };
    if (testInfo.project.use.hasTouch) await canvas.tap({ position });
    else await canvas.click({ position });
    await expect(page.locator("#message")).toContainText("Sun selected");
    await expect(settings).toBeHidden();
    await expect(restart).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#space-count")).toHaveText("54");
    await expect(page.locator("#turn-count")).toHaveText("MOVE 01");
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
    // Expanded controls must also fit on the smallest supported phone.
    await page.setViewportSize({ width: 320, height: 568 });
    await expect
        .poll(() =>
            page.evaluate(() => {
                const board = document.getElementById("game-canvas")!.getBoundingClientRect();
                const controls = document.querySelector(".controls")!.getBoundingClientRect();
                return (
                    board.width > 0 &&
                    board.bottom <= controls.top &&
                    controls.bottom <= innerHeight &&
                    document.documentElement.scrollHeight <= innerHeight &&
                    document.documentElement.scrollWidth <= innerWidth
                );
            }),
        )
        .toBe(true);
    await page.locator("#cancel-restart-btn").click();
    await expect(page.locator("#restart-confirm")).not.toBeVisible();
    expect(await page.locator("dialog, [aria-modal=true]").count()).toBe(0);
    await page.reload();
    await expect(page.locator("body")).toHaveClass(/reduced-motion/);
    await expect(page.locator("#sound-toggle")).toHaveAttribute("aria-pressed", "true");
});

for (const reducedMotion of ["reduce", "no-preference"] as const) {
    test(`idle painting stops and input wakes the board (${reducedMotion})`, async ({ page }) => {
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
        // Allow the 320 ms greeting and its final settled frame to complete.
        await page.clock.runFor(450);
        const counts = () => page.evaluate(() => [window.testFrames, window.testPaints]);
        const before = await counts();
        await page.clock.runFor(10000);
        const after = await counts();
        expect(after).toEqual(before);
        if (reducedMotion === "reduce") expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
        await page.locator("#game-canvas").press("Escape");
        await page.clock.runFor(100);
        const awakened = await counts();
        expect(awakened[1]).toBeGreaterThan(after[1]);
        await page.clock.runFor(10000);
        expect(await counts()).toEqual(awakened);
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
