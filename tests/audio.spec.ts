import { expect, test } from "@playwright/test";

declare global {
    interface Window {
        testAudioContexts: AudioContext[];
        testMusicTracks: HTMLAudioElement[];
    }
}

test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        window.testAudioContexts = [];
        window.testMusicTracks = [];
        const NativeContext = window.AudioContext;
        window.AudioContext = class extends NativeContext {
            constructor() {
                super();
                window.testAudioContexts.push(this);
            }
        };
        window.Audio = new Proxy(window.Audio, {
            construct(target, args) {
                const audio = new target(typeof args[0] === "string" ? args[0] : undefined);
                window.testMusicTracks.push(audio);
                return audio;
            },
        });
    });
});

test("audio defaults are quiet, gesture-gated, and suspend on mute/background", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.install();
    await page.goto("/");
    expect(await page.evaluate(() => window.testAudioContexts.length)).toBe(0);
    await expect(page.locator("#music-value")).toHaveText("10%");
    await expect(page.locator("#effects-value")).toHaveText("50%");
    await page.locator("#settings-toggle").click();
    await expect.poll(() => page.evaluate(() => window.testAudioContexts[0]?.state)).toBe("running");
    await expect
        .poll(() => page.evaluate(() => window.testMusicTracks.length === 2 && !window.testMusicTracks[0].paused))
        .toBe(true);
    for (let i = 0; i < 3; i++) {
        await page.locator("#mute-audio").check();
        await expect.poll(() => page.evaluate(() => window.testAudioContexts[0]?.state)).toBe("suspended");
        expect(await page.evaluate(() => window.testMusicTracks.every((track) => track.paused))).toBe(true);
        await page.locator("#mute-audio").uncheck();
        await expect.poll(() => page.evaluate(() => window.testAudioContexts[0]?.state)).toBe("running");
    }
    await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
        document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => page.evaluate(() => window.testAudioContexts[0].state)).toBe("suspended");
    expect(await page.evaluate(() => window.testMusicTracks.every((track) => track.paused))).toBe(true);
    await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
        document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => page.evaluate(() => window.testAudioContexts[0].state)).toBe("running");
    await page.locator("#music-volume").focus();
    await page.keyboard.press("Home");
    await expect(page.locator("#music-value")).toHaveText("0%");
    expect(await page.evaluate(() => window.testMusicTracks.every((track) => track.paused))).toBe(true);
    await page.clock.runFor(7100);
    await expect.poll(() => page.evaluate(() => window.testAudioContexts[0].state)).toBe("suspended");
    expect(await page.evaluate(() => window.testAudioContexts.length)).toBe(1);
    expect(errors).toEqual([]);
});

test("four songs crossfade in order through two decoders, including track4 back to track1", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
        if (message.type() === "warning" || message.type() === "error") errors.push(message.text());
    });
    await page.goto("/");
    await page.locator("#settings-toggle").click();
    await expect
        .poll(() =>
            page.evaluate(
                () =>
                    window.testMusicTracks.length === 2 &&
                    window.testMusicTracks.every((track) => track.readyState >= 2 && track.duration > 200),
            ),
        )
        .toBe(true);
    for (const song of [0, 1, 2, 3]) {
        const index = song % 2;
        await expect
            .poll(() => page.evaluate(() => window.testMusicTracks.every((track) => track.readyState >= 2)))
            .toBe(true);
        expect(await page.evaluate((i) => new URL(window.testMusicTracks[i].src).pathname, index)).toBe(
            `/music/track${song + 1}.m4a`,
        );
        await expect
            .poll(() =>
                page.evaluate((i) => !window.testMusicTracks[i].paused && window.testMusicTracks[1 - i].paused, index),
            )
            .toBe(true);
        await page.evaluate((i) => {
            const track = window.testMusicTracks[i];
            track.currentTime = track.duration - 3;
            track.dispatchEvent(new Event("timeupdate"));
        }, index);
        await expect.poll(() => page.evaluate(() => window.testMusicTracks.every((track) => !track.paused))).toBe(true);
        await expect
            .poll(() =>
                page.evaluate((i) => window.testMusicTracks[i].paused && !window.testMusicTracks[1 - i].paused, index),
            )
            .toBe(true);
    }
    expect(await page.evaluate(() => window.testMusicTracks.map((track) => new URL(track.src).pathname))).toEqual([
        "/music/track1.m4a",
        "/music/track2.m4a",
    ]);
    expect(await page.evaluate(() => window.testAudioContexts.length)).toBe(1);
    expect(errors).toEqual([]);
});

test("muting or hiding during a crossfade resumes only the incoming track", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
        if (message.type() === "warning" || message.type() === "error") errors.push(message.text());
    });
    await page.goto("/");
    await page.locator("#settings-toggle").click();
    await expect
        .poll(() =>
            page.evaluate(
                () =>
                    window.testMusicTracks.length === 2 &&
                    window.testMusicTracks.every((track) => track.readyState >= 2 && track.duration > 200),
            ),
        )
        .toBe(true);
    for (const [outgoing, reason] of [
        [0, "mute"],
        [1, "hidden"],
    ] as const) {
        await page.evaluate((index) => {
            const track = window.testMusicTracks[index];
            track.currentTime = track.duration - 2;
            track.dispatchEvent(new Event("timeupdate"));
        }, outgoing);
        await expect
            .poll(() =>
                page.evaluate(
                    (index) =>
                        window.testMusicTracks.every((track) => !track.paused) &&
                        window.testMusicTracks[1 - index].currentTime > 0.1,
                    outgoing,
                ),
            )
            .toBe(true);
        if (reason === "mute") await page.locator("#mute-audio").check();
        else
            await page.evaluate(() => {
                Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
                document.dispatchEvent(new Event("visibilitychange"));
            });
        await expect
            .poll(() =>
                page.evaluate(
                    () =>
                        window.testMusicTracks.every((track) => track.paused) &&
                        window.testAudioContexts[0].state === "suspended",
                ),
            )
            .toBe(true);
        if (reason === "mute") await page.locator("#mute-audio").uncheck();
        else
            await page.evaluate(() => {
                Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
                document.dispatchEvent(new Event("visibilitychange"));
            });
        // Real media time verifies playback continues beyond the cancelled
        // two-second fade timer; fake timers do not advance audio decoders.
        await expect
            .poll(() =>
                page.evaluate(
                    (index) =>
                        window.testMusicTracks[index].paused &&
                        !window.testMusicTracks[1 - index].paused &&
                        window.testMusicTracks[1 - index].currentTime > 2.3,
                    outgoing,
                ),
            )
            .toBe(true);
        expect(await page.evaluate((index) => new URL(window.testMusicTracks[index].src).pathname, outgoing)).toBe(
            `/music/track${outgoing + 3}.m4a`,
        );
    }
    expect(await page.evaluate(() => window.testAudioContexts.length)).toBe(1);
    expect(errors).toEqual([]);
});
