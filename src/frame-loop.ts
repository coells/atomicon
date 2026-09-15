const PAINT_INTERVAL_MS = 1000 / 30;

/** Demand-driven painting: sleep between animation frames, stop entirely at rest. */
export class FrameLoop {
    private frame: number | null = null;
    private timer: number | null = null;
    private deadline = 0;
    private dirty = false;
    private drawing = false;
    private paused = document.hidden;

    /** Return true while another animation frame (including the final settled frame) is needed. */
    constructor(private paint: (now: number) => boolean) {}

    request() {
        this.dirty = true;
        if (!this.paused && !this.drawing) this.schedule();
    }

    setPaused(paused: boolean) {
        this.paused = paused;
        if (this.frame !== null) cancelAnimationFrame(this.frame);
        if (this.timer !== null) window.clearTimeout(this.timer);
        this.frame = this.timer = null;
        this.deadline = 0;
        if (!paused) this.request();
    }

    private schedule() {
        if (this.frame !== null || this.timer !== null) return;
        // Wake just before the deadline, then let rAF align the paint to the
        // display. No polling callbacks at 60/120 Hz between 30 Hz paints.
        const delay = this.deadline - performance.now() - 1;
        if (delay > 0) {
            this.timer = window.setTimeout(() => {
                this.timer = null;
                this.frame = requestAnimationFrame(this.tick);
            }, delay);
        } else {
            this.frame = requestAnimationFrame(this.tick);
        }
    }

    private tick = (now: number) => {
        this.frame = null;
        if (this.paused) return;
        this.dirty = false;
        this.drawing = true;
        let animate: boolean;
        try {
            animate = this.paint(now);
        } finally {
            this.drawing = false;
        }
        if (!this.paused && (animate || this.dirty)) {
            // Preserve the cadence when a display frame arrives slightly late,
            // but never catch up with a burst after a long stall.
            this.deadline = this.deadline ? this.deadline + PAINT_INTERVAL_MS : now + PAINT_INTERVAL_MS;
            if (this.deadline <= now) this.deadline = now + PAINT_INTERVAL_MS;
            this.schedule();
        } else {
            this.deadline = 0;
        }
    };
}
