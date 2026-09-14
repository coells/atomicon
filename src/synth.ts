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
