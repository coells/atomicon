import { expect, test } from "@playwright/test";

test("the production build boots and loads all local assets under /atomicon/", async ({ page }) => {
    const failures: string[] = [];
    const loaded = new Set<string>();
    page.on("pageerror", (error) => failures.push(error.message));
    page.on("console", (message) => {
        if (message.type() === "error") failures.push(message.text());
    });
    page.on("response", (response) => {
        if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
        else loaded.add(new URL(response.url()).pathname);
    });
    await page.goto("./");
    await page.evaluate(() => document.fonts.ready);
    expect(failures).toEqual([]);
    await expect(page.locator("#game-canvas")).toHaveCSS("width", /[3-9]\d\dpx/);
    expect(await page.locator("#game-canvas").evaluate((canvas) => canvas.style.width)).not.toBe("");
    await page.locator("#settings-toggle").click();
    await expect(page.locator("#settings-panel")).toBeVisible();
    // Wait for the gesture-triggered music requests too, rather than passing
    // before a missing production asset has time to return a 404.
    await expect
        .poll(() =>
            ["background.webp", "characters/atlas.webp", "music/track1.m4a", "music/track2.m4a"].every((asset) =>
                loaded.has(`/atomicon/${asset}`),
            ),
        )
        .toBe(true);
    // Later songs are deliberately not preloaded into additional media elements.
    for (const number of [3, 4]) {
        const response = await page.request.get(new URL(`music/track${number}.m4a`, page.url()).href, {
            headers: { Range: "bytes=0-1023" },
        });
        expect(response.ok()).toBe(true);
        expect(response.headers()["content-type"]).toContain("audio/");
    }
    expect(failures).toEqual([]);
});
