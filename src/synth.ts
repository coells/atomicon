import { midiToFrequency, type MusicNote } from "./music";

/** Schedule a voice on a real-time or offline graph. Sources own their cleanup;
 * callers retain handles only to cancel notes when muting or backgrounding. */
export function scheduleVoice(
    ctx: BaseAudioContext,
    destination: AudioNode,
    note: MusicNote,
    at: number,
): OscillatorNode[] {
    const frequency = midiToFrequency(note.midi);
    const pad = note.voice === "pad";
    // Felt keys have a quiet, fast-decaying overtone; string voices use
    // detuned triangles softened by a low-pass filter.
    const partials = pad
        ? [
              { ratio: 1, gain: 0.5, detune: -5 },
              { ratio: 1, gain: 0.5, detune: 5 },
          ]
        : note.voice === "key" || note.voice === "glint"
          ? [
                { ratio: 1, gain: 1, detune: 0 },
                { ratio: 2.001, gain: 0.18, detune: 0 },
                { ratio: 3, gain: 0.035, detune: 0 },
            ]
          : [{ ratio: 1, gain: 1, detune: 0 }];
    return partials.map((partial) => {
        const osc = ctx.createOscillator();
        const envelope = ctx.createGain();
        const pan = ctx.createStereoPanner();
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = pad ? 1300 : note.voice === "bass" ? 500 : 5800;
        osc.type = pad ? "triangle" : "sine";
        osc.frequency.value = frequency * partial.ratio;
        osc.detune.value = partial.detune;
        pan.pan.value = note.pan;
        const duration = partial.ratio > 1 ? note.duration * 0.45 : note.duration;
        const attack = pad ? 1.5 : note.voice === "bass" ? 0.07 : 0.008;
        const peak = Math.max(0.0002, note.velocity * partial.gain);
        envelope.gain.setValueAtTime(0.0001, at);
        envelope.gain.exponentialRampToValueAtTime(peak, at + attack);
        if (pad) envelope.gain.setValueAtTime(peak, at + duration * 0.6);
        envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
        osc.connect(filter).connect(envelope).connect(pan).connect(destination);
        osc.addEventListener(
            "ended",
            () => {
                osc.disconnect();
                filter.disconnect();
                envelope.disconnect();
                pan.disconnect();
            },
            { once: true },
        );
        osc.start(at);
        osc.stop(at + duration + 0.03);
        return osc;
    });
}

/** Approved rounded movement pair: four bounded sources, with a short held body. */
export function scheduleMovement(ctx: BaseAudioContext, destination: AudioNode, at: number): OscillatorNode[] {
    const variation = Math.random() * 2 - 1;
    return [62, 69].flatMap((midi, index) => {
        const frequency = midiToFrequency(midi) * 2 ** ((variation * 2) / 1200);
        const start = at + index * 0.09;
        const level = index === 0 ? 0.115 : 0.08;
        return [false, true].map((overtone) => {
            const osc = ctx.createOscillator();
            const filter = ctx.createBiquadFilter();
            const gain = ctx.createGain();
            const pan = ctx.createStereoPanner();
            const duration = overtone ? 0.48 * 0.55 : 0.48;
            const peak = overtone ? level * 0.12 : level;
            osc.type = "sine";
            osc.frequency.value = frequency * (overtone ? 2.001 : 1);
            filter.type = "lowpass";
            filter.frequency.value = 3200;
            filter.Q.value = 0.55;
            pan.pan.value = overtone ? 0 : (index - 0.5) * 0.1;
            gain.gain.setValueAtTime(0, start);
            gain.gain.linearRampToValueAtTime(peak, start + 0.018);
            gain.gain.exponentialRampToValueAtTime(peak * 0.45, start + duration * (overtone ? 0.16 : 0.24));
            gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
            gain.gain.linearRampToValueAtTime(0, start + duration + 0.02);
            osc.connect(filter).connect(gain).connect(pan).connect(destination);
            osc.addEventListener(
                "ended",
                () => {
                    osc.disconnect();
                    filter.disconnect();
                    gain.disconnect();
                    pan.disconnect();
                },
                { once: true },
            );
            osc.start(start);
            osc.stop(start + duration + 0.025);
            return osc;
        });
    });
}
