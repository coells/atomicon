import { expect, test } from "@playwright/test";

test("the approved movement pair has four sources, an audible body, and a bounded tail", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
        const url = "/src/synth.ts";
        const { scheduleMovement }: typeof import("../src/synth") = await import(url);
        const render = async (cancel: boolean) => {
            const ctx = new OfflineAudioContext(2, 48000, 48000);
            const random = Math.random;
            let randomCalls = 0;
            Math.random = () => {
                randomCalls++;
                return 0.5;
            };
            let sources: OscillatorNode[];
            try {
                sources = scheduleMovement(ctx, ctx.destination, 0.05);
            } finally {
                Math.random = random;
            }
            if (cancel) for (const source of sources) source.stop(0.18);
            const audio = await ctx.startRendering();
            const samples = audio.getChannelData(0);
            const rms = (start: number, end: number) => {
                const slice = samples.subarray(Math.floor(start * 48000), Math.floor(end * 48000));
                return Math.sqrt(slice.reduce((sum, value) => sum + value * value, 0) / slice.length);
            };
            return {
                sources: sources.length,
                randomCalls,
                peak: samples.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0),
                before: rms(0, 0.049),
                body: rms(0.09, 0.17),
                middle: rms(0.25, 0.35),
                after: rms(0.7, 1),
            };
        };
        return { full: await render(false), cancelled: await render(true) };
    });
    expect(result.full.sources).toBe(4);
    expect(result.full.randomCalls).toBe(1);
    expect(result.full.before).toBe(0);
    expect(result.full.body).toBeGreaterThan(0.01);
    expect(result.full.middle).toBeGreaterThan(0.001);
    expect(result.full.peak).toBeLessThan(0.3);
    expect(result.full.after).toBe(0);
    expect(result.cancelled.middle).toBe(0);
    expect(result.cancelled.after).toBe(0);
});

test("the controller uses the new movement pair but retains the original clear notes", async ({ page }) => {
    await page.goto("/");
    await page.locator("#settings-toggle").click();
    const result = await page.evaluate(async () => {
        const url = "/src/audio.ts";
        const { Soundscape }: typeof import("../src/audio") = await import(url);
        const sound = new Soundscape();
        const preferences = { music: 0, effects: 0.5, muted: false };
        sound.setPreferences(preferences);
        await sound.unlock();
        const create = AudioContext.prototype.createOscillator;
        let captured: OscillatorNode[] = [];
        AudioContext.prototype.createOscillator = function () {
            const osc = create.call(this);
            captured.push(osc);
            return osc;
        };
        try {
            const capture = (kind: "move" | "clear", strength: number) => {
                captured = [];
                sound.effect(kind, strength);
                return captured.map((osc) => osc.frequency.value);
            };
            return { move: capture("move", 1), clear: capture("clear", 1), large: capture("clear", 3) };
        } finally {
            AudioContext.prototype.createOscillator = create;
            sound.setPreferences({ ...preferences, muted: true });
        }
    });
    expect(result.move).toHaveLength(4);
    for (const [frequencies, notes] of [
        [result.clear, [74, 78, 81, 86]],
        [result.large, [74, 78, 81, 85, 90]],
    ] as const) {
        const expected = notes.flatMap((midi) => [1, 2.001, 3].map((ratio) => 440 * 2 ** ((midi - 69) / 12) * ratio));
        expect(frequencies).toHaveLength(expected.length);
        expected.forEach((frequency, i) => expect(frequencies[i]).toBeCloseTo(frequency, 2));
    }
});
