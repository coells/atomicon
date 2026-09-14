const CROSSFADE_SECONDS = 8;

interface Track {
    audio: HTMLAudioElement;
    gain: GainNode;
    source: MediaElementAudioSourceNode;
}

/** Two streaming decoders, never whole-track AudioBuffers. Overlap both joins,
 * including track2 → track1; pause media and cancel fades when hidden/muted. */
export class MusicPlaylist {
    private tracks: [Track, Track];
    private active = 0;
    private running = false;
    private primed = false;
    private transitioning = false;
    private transitionFailed = false;
    private generation = 0;
    private fadeTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(
        private context: AudioContext,
        destination: AudioNode,
    ) {
        const makeTrack = (index: number): Track => {
            const audio = new Audio(`${import.meta.env.BASE_URL}music/track${index + 1}.m4a`);
            audio.preload = "auto";
            audio.setAttribute("playsinline", "");
            const source = context.createMediaElementSource(audio);
            const gain = context.createGain();
            gain.gain.value = 0;
            source.connect(gain).connect(destination);
            audio.addEventListener("timeupdate", () => this.checkBoundary());
            audio.addEventListener("ended", () => {
                if (this.running && this.active === index) this.crossfade();
            });
            return { audio, gain, source };
        };
        this.tracks = [makeTrack(0), makeTrack(1)];
    }

    start() {
        this.transitionFailed = false;
        if (this.running) {
            this.checkBoundary();
            return;
        }
        this.running = true;
        const generation = ++this.generation;
        const active = this.tracks[this.active];
        const standby = this.tracks[1 - this.active];
        this.setGain(active, 1);
        this.setGain(standby, 0);
        // Both play() calls occur synchronously inside the unlocking gesture.
        // Prime then pause the silent standby so Safari can start it later.
        if (!this.primed) {
            this.primed = true;
            void standby.audio
                .play()
                .then(() => {
                    if (!this.running || this.tracks[this.active] !== standby) {
                        standby.audio.pause();
                        standby.audio.currentTime = 0;
                    }
                })
                .catch(() => {
                    this.primed = false;
                });
        }
        void active.audio
            .play()
            .then(() => {
                if (generation !== this.generation || !this.running) {
                    if (!this.running || this.tracks[this.active] !== active) active.audio.pause();
                    return;
                }
                this.checkBoundary();
            })
            .catch((error) => {
                if (generation !== this.generation) return;
                this.pause();
                console.warn("Music playback unavailable:", error);
            });
    }

    pause() {
        this.running = false;
        this.generation++;
        clearTimeout(this.fadeTimer);
        this.fadeTimer = undefined;
        this.transitioning = false;
        for (const [index, track] of this.tracks.entries()) {
            track.audio.pause();
            this.setGain(track, index === this.active ? 1 : 0);
            if (index !== this.active) track.audio.currentTime = 0;
        }
    }

    private setGain(track: Track, value: number) {
        // Remove an entire in-progress curve before inserting a new value.
        track.gain.gain.cancelScheduledValues(0);
        track.gain.gain.setValueAtTime(value, this.context.currentTime);
    }

    private checkBoundary() {
        if (!this.running || this.transitioning || this.transitionFailed) return;
        const audio = this.tracks[this.active].audio;
        if (
            Number.isFinite(audio.duration) &&
            audio.duration > 0 &&
            audio.duration - audio.currentTime <= CROSSFADE_SECONDS
        )
            this.crossfade();
    }

    private crossfade() {
        if (!this.running || this.transitioning || this.transitionFailed) return;
        this.transitioning = true;
        const generation = this.generation;
        const outgoing = this.tracks[this.active];
        const nextIndex = 1 - this.active;
        const incoming = this.tracks[nextIndex];
        incoming.audio.currentTime = 0;
        this.setGain(incoming, 0);
        void incoming.audio
            .play()
            .then(() => {
                if (generation !== this.generation || !this.running) {
                    if (!this.running || this.tracks[this.active] !== incoming) incoming.audio.pause();
                    return;
                }
                this.active = nextIndex;
                const remaining = outgoing.audio.duration - outgoing.audio.currentTime;
                const seconds = Number.isFinite(remaining)
                    ? Math.max(0.15, Math.min(CROSSFADE_SECONDS, remaining))
                    : CROSSFADE_SECONDS;
                const fadeIn = new Float32Array(64);
                const fadeOut = new Float32Array(64);
                for (let i = 0; i < fadeIn.length; i++) {
                    const angle = ((i / (fadeIn.length - 1)) * Math.PI) / 2;
                    fadeIn[i] = Math.sin(angle);
                    fadeOut[i] = Math.cos(angle);
                }
                const at = this.context.currentTime;
                this.setGain(outgoing, 1);
                incoming.gain.gain.setValueCurveAtTime(fadeIn, at, seconds);
                outgoing.gain.gain.setValueCurveAtTime(fadeOut, at, seconds);
                this.fadeTimer = setTimeout(
                    () => {
                        if (generation !== this.generation || !this.running) return;
                        outgoing.audio.pause();
                        outgoing.audio.currentTime = 0;
                        this.setGain(outgoing, 0);
                        this.setGain(incoming, 1);
                        this.transitioning = false;
                        this.fadeTimer = undefined;
                    },
                    (seconds + 0.05) * 1000,
                );
            })
            .catch((error) => {
                if (generation !== this.generation) return;
                this.transitioning = false;
                this.transitionFailed = true;
                console.warn("Unable to start the next music track:", error);
            });
    }
}
