/** Original ambient score and synthesis from commit 231cc08.
 * Only routing, source cleanup, and lifecycle are adapted to the current app. */
export class AmbientMusic {
    private musicRunning = false;
    private harmStep = 0;
    private melodyPos = 0;
    private activeNodes: { osc: OscillatorNode; stop: number }[] = [];
    private masterGain: GainNode;
    private reverbSend: GainNode;
    private reverbReturn: ConvolverNode;
    private compressor: DynamicsCompressorNode;
    private harmonyTimer: ReturnType<typeof setInterval> | undefined;
    private melodyTimer: ReturnType<typeof setInterval> | undefined;
    constructor(
        private actx: AudioContext,
        destination: AudioNode,
    ) {
        const ctx = actx;
        this.masterGain = ctx.createGain();
        this.compressor = ctx.createDynamicsCompressor();
        this.compressor.threshold.value = -20;
        this.compressor.knee.value = 14;
        this.compressor.ratio.value = 3;
        this.compressor.attack.value = 0.1;
        this.compressor.release.value = 0.3;
        this.masterGain.connect(this.compressor).connect(destination);
        this.reverbReturn = this.buildReverb(ctx, 3.5, 2.2);
        this.reverbReturn.connect(this.masterGain);
        this.reverbSend = ctx.createGain();
        this.reverbSend.gain.value = 0.6;
        this.reverbSend.connect(this.reverbReturn);
    }
    start() {
        if (this.musicRunning) return;
        this.musicRunning = true;
        this.masterGain.gain.setValueAtTime(0.0001, this.actx.currentTime);
        this.masterGain.gain.exponentialRampToValueAtTime(1, this.actx.currentTime + 3);
        this.playChord();
        this.harmonyTimer = setInterval(() => this.advanceHarmony(), 10000);
        this.melodyTimer = setInterval(() => this.melodyTick(), 650);
    }
    stop() {
        this.musicRunning = false;
        clearInterval(this.harmonyTimer);
        clearInterval(this.melodyTimer);
        for (const node of this.activeNodes) {
            node.osc.stop();
            node.osc.disconnect();
        }
        this.activeNodes = [];
    }
    dispose() {
        this.stop();
        this.masterGain.disconnect();
        this.compressor.disconnect();
        this.reverbSend.disconnect();
        this.reverbReturn.disconnect();
    }
    private midiToFreq(midi: number) {
        return 440 * 2 ** ((midi - 69) / 12);
    }
    private track(osc: OscillatorNode, stop: number, nodes: AudioNode[]) {
        this.activeNodes.push({ osc, stop });
        osc.addEventListener(
            "ended",
            () => {
                osc.disconnect();
                nodes.forEach((node) => node.disconnect());
                this.activeNodes = this.activeNodes.filter((node) => node.osc !== osc);
            },
            { once: true },
        );
    }
    private readonly chords: { root: number; voicing: number[] }[] = [
        { root: 50, voicing: [50, 57, 64, 66, 69] }, // Dmaj9      D F# A B  C#  (add9)
        { root: 47, voicing: [47, 54, 59, 62, 66] }, // Bm7        B F# A  D  F#
        { root: 55, voicing: [55, 59, 62, 66, 71] }, // Gmaj7      G B  D  F# B
        { root: 52, voicing: [52, 56, 59, 64, 67] }, // Em9        E G# B  E  G
        { root: 54, voicing: [54, 57, 61, 64, 69] }, // F#m7       F# A C# E  A
        { root: 57, voicing: [57, 61, 64, 66, 69] }, // Amaj7      A  C# E F# A
        { root: 50, voicing: [50, 54, 57, 61, 66] }, // Dsus→maj   D  F# A C# F#
        { root: 55, voicing: [55, 59, 62, 67, 71] }, // G6/9       G  B  D  G  B
    ];

    /*
     * Melody fragments — short motifs that drift over the chords.
     * Written as semitone offsets from current chord root.
     * -1 = rest (silence). Sparse and unpredictable.
     */
    private readonly melodyFragments: number[][] = [
        [12, -1, -1, 16, -1, 14, -1, -1, -1, 12, -1, -1, 9, -1, -1, -1],
        [-1, -1, 7, -1, -1, 12, -1, 14, -1, -1, -1, -1, 16, -1, -1, -1],
        [24, -1, -1, -1, 21, -1, -1, -1, -1, 19, -1, -1, -1, -1, -1, -1],
        [-1, 9, -1, -1, -1, -1, 7, -1, -1, -1, 12, -1, -1, -1, -1, -1],
        [-1, -1, -1, 14, -1, -1, -1, -1, 12, -1, -1, 9, -1, -1, 7, -1],
        [-1, -1, -1, -1, -1, 19, -1, -1, -1, -1, 16, -1, -1, -1, -1, 14],
        [7, -1, -1, -1, -1, -1, -1, -1, 9, -1, -1, -1, -1, -1, -1, -1],
        [-1, -1, 12, -1, -1, -1, -1, -1, -1, -1, -1, 7, -1, -1, -1, -1],
    ];

    /* ── reverb impulse ── */
    private buildReverb(ctx: AudioContext, duration: number, decay: number): ConvolverNode {
        const rate = ctx.sampleRate;
        const length = Math.floor(rate * duration);
        const impulse = ctx.createBuffer(2, length, rate);
        for (let ch = 0; ch < 2; ch++) {
            const data = impulse.getChannelData(ch);
            for (let i = 0; i < length; i++) {
                const t = i / rate;
                const env = Math.exp(-t * decay) * (1 + 0.35 * Math.exp(-t * 22));
                data[i] = (Math.random() * 2 - 1) * env;
            }
        }
        const conv = ctx.createConvolver();
        conv.buffer = impulse;
        return conv;
    }

    /* ── play a sustained chord (voices fade in / out over ~9s) ── */
    private playChord() {
        if (!this.musicRunning || !this.actx || this.actx.state !== "running") return;
        const ctx = this.actx;
        const now = ctx.currentTime;
        const chord = this.chords[this.harmStep % this.chords.length];

        for (let i = 0; i < chord.voicing.length; i++) {
            const midi = chord.voicing[i];
            const freq = this.midiToFreq(midi);
            // two detuned oscillators per voice for warmth
            for (const detune of [-4, 4]) {
                const osc = ctx.createOscillator();
                osc.type = "sine";
                osc.frequency.value = freq;
                osc.detune.value = detune + (Math.random() - 0.5) * 2;

                const g = ctx.createGain();
                const vol = 0.007 + (i === 0 ? 0.004 : 0); // root slightly louder
                const attack = 1.8 + Math.random() * 1.2;
                const hold = 5 + Math.random() * 2;
                const release = hold + 2.5 + Math.random();
                const total = release + 0.5;

                g.gain.setValueAtTime(0.0001, now);
                g.gain.exponentialRampToValueAtTime(vol, now + attack);
                g.gain.setValueAtTime(vol, now + hold);
                g.gain.exponentialRampToValueAtTime(0.0001, now + release);

                osc.connect(g);
                g.connect(this.masterGain!);
                g.connect(this.reverbSend!);
                osc.start(now);
                osc.stop(now + total);
                this.track(osc, now + total, [g]);
            }
        }

        // cleanup old expired nodes
        this.activeNodes = this.activeNodes.filter((n) => n.stop > now);
    }

    /* ── advance to next chord ── */
    private advanceHarmony() {
        if (!this.musicRunning) return;
        this.harmStep = (this.harmStep + 1) % this.chords.length;
        this.playChord();
    }

    /* ── melody: play one note from the current fragment ── */
    private melodyTick() {
        if (!this.musicRunning || !this.actx) return;
        const ctx = this.actx;
        if (ctx.state !== "running") return;

        const fragIdx = this.harmStep % this.melodyFragments.length;
        const frag = this.melodyFragments[fragIdx];
        const step = this.melodyPos % frag.length;
        this.melodyPos++;

        const interval = frag[step];
        if (interval < 0) return; // rest

        const chord = this.chords[this.harmStep % this.chords.length];
        const midi = chord.root + interval;
        const freq = this.midiToFreq(midi);
        const now = ctx.currentTime;

        // soft bell-like tone
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = freq;

        // gentle vibrato via second oscillator
        const vib = ctx.createOscillator();
        vib.type = "sine";
        vib.frequency.value = 4.5 + Math.random();
        const vibG = ctx.createGain();
        vibG.gain.value = 1.5; // ±1.5 Hz
        vib.connect(vibG).connect(osc.frequency);
        vib.start(now);

        const g = ctx.createGain();
        const vol = 0.016 + Math.random() * 0.008;
        const dur = 2.8 + Math.random() * 2;
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(vol, now + 0.05);
        g.gain.exponentialRampToValueAtTime(vol * 0.5, now + dur * 0.4);
        g.gain.exponentialRampToValueAtTime(0.0001, now + dur);

        osc.connect(g);
        g.connect(this.masterGain!);
        g.connect(this.reverbSend!);
        osc.start(now);
        osc.stop(now + dur + 0.1);
        vib.stop(now + dur + 0.1);
        this.track(osc, now + dur + 0.1, [g]);
        this.track(vib, now + dur + 0.1, [vibG]);

        // quiet octave shimmer ~30% of the time
        if (Math.random() > 0.7) {
            const osc2 = ctx.createOscillator();
            osc2.type = "sine";
            osc2.frequency.value = freq * 2;
            const g2 = ctx.createGain();
            g2.gain.setValueAtTime(0.0001, now + 0.1);
            g2.gain.exponentialRampToValueAtTime(0.005, now + 0.16);
            g2.gain.exponentialRampToValueAtTime(0.0001, now + dur * 0.7);
            osc2.connect(g2);
            g2.connect(this.reverbSend!);
            osc2.start(now + 0.1);
            osc2.stop(now + dur);
            this.track(osc2, now + dur, [g2]);
        }
    }
}
