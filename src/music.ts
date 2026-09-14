/** Four slow movements in D major / B minor. Sparse keys, open voicings,
 * and rests replace the continuous eight-phrase ostinato. */
export const BEAT_SECONDS = 60 / 52;
export const STEP_SECONDS = BEAT_SECONDS / 2;
export const PHRASE_STEPS = 32;
export const SCORE_STEPS = PHRASE_STEPS * 32;

export interface MusicNote {
    midi: number;
    voice: "pad" | "key" | "bass" | "glint" | "pulse";
    duration: number;
    velocity: number;
    pan: number;
}

const PHRASES = [
    { chord: [50, 57, 61, 66, 69], tune: [78, -1, 76, -1, 73, -1, -1, 69, 73, -1, 76, -1, 78, -1, -1, -1] },
    { chord: [47, 54, 57, 62, 66], tune: [78, -1, -1, 74, 73, -1, 69, -1, 66, -1, -1, 69, 74, -1, -1, -1] },
    { chord: [43, 50, 54, 59, 62], tune: [74, -1, 73, -1, 71, -1, -1, 66, 69, -1, 71, -1, 74, -1, -1, -1] },
    { chord: [45, 52, 57, 59, 64], tune: [76, -1, -1, 73, 71, -1, 69, -1, 71, -1, -1, 73, 76, -1, -1, -1] },
    { chord: [40, 47, 54, 55, 62], tune: [79, -1, 78, -1, 74, -1, -1, 71, 74, -1, 78, -1, 76, -1, -1, -1] },
    { chord: [47, 54, 57, 61, 66], tune: [78, -1, -1, 76, 73, -1, 69, -1, 66, -1, -1, 69, 73, -1, -1, -1] },
    { chord: [43, 50, 54, 59, 62], tune: [74, -1, 78, -1, 81, -1, -1, 78, 74, -1, 71, -1, 69, -1, -1, -1] },
    { chord: [45, 52, 55, 61, 64], tune: [73, -1, -1, 71, 69, -1, 64, -1, 69, -1, -1, 73, 76, -1, -1, -1] },
];

export function musicNotesAt(step: number, intensity: number, ending = false): MusicNote[] {
    const movement = Math.floor(step / (PHRASE_STEPS * 8)) % 4;
    const orders = [
        [0, 1, 2, 3, 4, 5, 6, 7],
        [4, 2, 5, 1, 6, 0, 7, 3],
        [1, 5, 4, 6, 2, 7, 0, 3],
        [6, 4, 1, 2, 5, 3, 7, 0],
    ];
    const phraseIndex = Math.floor(step / PHRASE_STEPS) % 8;
    const phrase = PHRASES[orders[movement][phraseIndex]];
    const beat = step % PHRASE_STEPS;
    const notes: MusicNote[] = [];
    if (beat === 0) {
        [0, 2, 4].forEach((index, i) =>
            notes.push({
                midi: phrase.chord[index],
                voice: "pad",
                duration: STEP_SECONDS * 25,
                velocity: 0.013,
                pan: (i - 1) * 0.3,
            }),
        );
    }
    if (ending) return notes;
    const melody = phrase.tune[(Math.floor(beat / 2) + movement * 4) % 16];
    if (melody >= 0 && beat % 4 === 0 && beat < 24 && !(movement === 2 && phraseIndex % 2 === 0))
        notes.push({
            midi: melody - (movement === 3 ? 12 : 0),
            voice: "key",
            duration: 4,
            velocity: 0.035,
            pan: movement % 2 ? 0.2 : -0.2,
        });
    // No rhythmic pulse or escalating density on a crowded board.
    if (intensity > 0.7 && beat === 22 && phraseIndex % 3 === 1)
        notes.push({
            midi: phrase.chord[3] + 12,
            voice: "glint",
            duration: 1.9,
            velocity: 0.012,
            pan: 0.4,
        });
    return notes;
}

export function midiToFrequency(midi: number): number {
    return 440 * 2 ** ((midi - 69) / 12);
}
