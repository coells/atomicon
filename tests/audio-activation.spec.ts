import { expect, test } from "@playwright/test";

declare global {
    interface Window {
        policyContexts: AudioContext[];
        policyTracks: HTMLAudioElement[];
        policyOscillators: number;
        interruptAudio: () => Promise<void>;
    }
}

test.use({ hasTouch: true });

test.beforeEach(async ({ page }) => {
    // Desktop WebKit does not reproduce iOS's activation/interruption policy.
    // Impose that policy at the native audio boundary, keeping real decoders,
    // the audio graph, trusted touch events, and the production controller.
    await page.addInitScript(() => {
        Math.random = () => 0.5;
        window.policyContexts = [];
        window.policyTracks = [];
        window.policyOscillators = 0;
        let inGesture = false;
        const add = document.addEventListener;
        document.addEventListener = function (
            type: string,
            listener: EventListenerOrEventListenerObject | null,
            options?: boolean | AddEventListenerOptions,
        ) {
            if (!listener) return;
            return add.call(
                this,
                type,
                (event: Event) => {
                    const previous = inGesture;
                    inGesture =
                        event.isTrusted &&
                        (event.type === "touchend" ||
                            event.type === "click" ||
                            event.type === "keydown" ||
                            (event instanceof PointerEvent &&
                                ((event.type === "pointerdown" && event.pointerType === "mouse") ||
                                    (event.type === "pointerup" && event.pointerType !== "mouse"))));
                    try {
                        if (typeof listener === "function") listener.call(document, event);
                        else listener.handleEvent(event);
                    } finally {
                        inGesture = previous;
                    }
                },
                options,
            );
        };
        const NativeContext = window.AudioContext;
        window.AudioContext = class extends NativeContext {
            private authorized = false;
            private interrupted = false;
            constructor() {
                super();
                void super.suspend();
                window.policyContexts.push(this);
                window.interruptAudio = async () => {
                    this.interrupted = true;
                    await super.suspend();
                };
            }
            get state(): AudioContextState {
                if (this.interrupted) return "interrupted";
                return this.authorized ? super.state : "suspended";
            }
            resume() {
                if (!this.authorized && !inGesture)
                    return Promise.reject(new DOMException("Complete the touch gesture first", "NotAllowedError"));
                this.authorized = true;
                this.interrupted = false;
                return super.resume();
            }
            createOscillator() {
                window.policyOscillators++;
                return super.createOscillator();
            }
        };
        const play = HTMLMediaElement.prototype.play;
        const authorized = new WeakSet<HTMLMediaElement>();
        HTMLMediaElement.prototype.play = function () {
            if (!authorized.has(this) && !inGesture)
                return Promise.reject(new DOMException("Media needs a completed gesture", "NotAllowedError"));
            authorized.add(this);
            return play.call(this);
        };
        window.Audio = new Proxy(window.Audio, {
            construct(target, args) {
                const audio = new target(typeof args[0] === "string" ? args[0] : undefined);
                window.policyTracks.push(audio);
                return audio;
            },
        });
    });
});

test("a completed touch unlocks both music and board effects", async ({ page }) => {
    await page.goto("/");
    expect(await page.evaluate(() => window.policyContexts.length)).toBe(0);
    await page.locator("#settings-toggle").tap();
    await expect.poll(() => page.evaluate(() => window.policyContexts[0]?.state)).toBe("running");
    await expect
        .poll(() =>
            page.evaluate(
                () =>
                    window.policyTracks.length === 2 &&
                    !window.policyTracks[0].paused &&
                    window.policyTracks[0].currentTime > 0.1,
            ),
        )
        .toBe(true);
    await expect(page.locator("#game-canvas")).toHaveAttribute("aria-busy", "false");
    const canvas = page.locator("#game-canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("Missing board");
    const radius = (box.width - 6) / (Math.sqrt(3) * 8 + 2.2);
    await canvas.tap({ position: { x: box.width / 2 + Math.sqrt(3) * radius, y: box.height / 2 } });
    await expect(page.locator("#message")).toContainText("Sun selected");
    expect(await page.evaluate(() => window.policyOscillators)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.policyContexts.length)).toBe(1);
});

test("a tap resumes an iOS-interrupted context without replacing it", async ({ page }) => {
    await page.goto("/");
    // Mouse activation isolates recovery from the separate touch-unlock bug.
    await page.locator("#settings-toggle").click();
    await expect.poll(() => page.evaluate(() => window.policyContexts[0]?.state)).toBe("running");
    await page.evaluate(() => window.interruptAudio());
    expect(await page.evaluate(() => window.policyContexts[0].state)).toBe("interrupted");
    await page.locator("#settings-toggle").tap();
    await expect.poll(() => page.evaluate(() => window.policyContexts[0].state)).toBe("running");
    expect(await page.evaluate(() => window.policyContexts.length)).toBe(1);
});
