import { expect, test } from "@playwright/test";

test.use({ hasTouch: true });
test("two finger taps select and move without a hover or a scroll", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
        Math.random = () => 0.5;
    });
    await page.goto("/");
    await expect(page.locator("#game-canvas")).toHaveAttribute("aria-busy", "false");
    const canvas = page.locator("#game-canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("Missing board");
    const r = (box.width - Math.min(3, box.width * 0.068) * 2) / (Math.sqrt(3) * 8 + 2.2);
    await canvas.tap({ position: { x: box.width / 2 + Math.sqrt(3) * r, y: box.height / 2 } });
    await expect(page.locator("#message")).toContainText("Sun selected");
    await canvas.tap({ position: { x: box.width / 2 + (Math.sqrt(3) * r) / 2, y: box.height / 2 - 1.5 * r } });
    await expect(page.locator("#turn-count")).toHaveText("MOVE 02");
    await expect(canvas).toHaveAttribute("aria-busy", "false");
    expect(await page.evaluate(() => scrollY)).toBe(0);
});
