import { expect, test } from "@playwright/test";
import { musicNotesAt, midiToFrequency, PHRASE_STEPS, STEP_SECONDS, SCORE_STEPS } from "../src/music";
import { parsePreferences, parseScores } from "../src/preferences";
import { ALL_VALID_POSITIONS, checkLines, createEmptyGrid, findPath, isValidCell, JOKER_COLOR } from "../src/game";

test("the score loops on phrase boundaries with finite, in-key notes", () => {
    expect(midiToFrequency(69)).toBe(440);
    expect(STEP_SECONDS * SCORE_STEPS).toBeGreaterThan(580);
    const pitchClasses = new Set([1, 2, 4, 6, 7, 9, 11]);
    for (let step = 0; step < SCORE_STEPS; step++) {
        const notes = musicNotesAt(step, 1);
        expect(notes).toEqual(musicNotesAt(step + SCORE_STEPS, 1));
        for (const note of notes) {
            expect(pitchClasses.has(note.midi % 12)).toBe(true);
            expect(note.velocity).toBeGreaterThan(0);
            expect(note.duration).toBeGreaterThan(0);
            expect(note.pan).toBeGreaterThanOrEqual(-1);
            expect(note.pan).toBeLessThanOrEqual(1);
            expect(Number.isFinite(midiToFrequency(note.midi))).toBe(true);
        }
    }
});

test("long movements vary, stay sparse, and never add a rhythmic pulse", () => {
    const quiet = Array.from({ length: SCORE_STEPS }, (_, step) => musicNotesAt(step, 0)).flat();
    const active = Array.from({ length: SCORE_STEPS }, (_, step) => musicNotesAt(step, 1)).flat();
    expect(active.some((note) => note.voice === "pulse")).toBe(false);
    expect(quiet.length / (SCORE_STEPS * STEP_SECONDS)).toBeLessThan(0.5);
    const movements = Array.from({ length: 4 }, (_, movement) =>
        JSON.stringify(
            Array.from({ length: PHRASE_STEPS * 8 }, (_, step) => musicNotesAt(step + movement * PHRASE_STEPS * 8, 0)),
        ),
    );
    expect(new Set(movements).size).toBe(4);
    expect(active.filter((note) => note.voice === "key")).toEqual(quiet.filter((note) => note.voice === "key"));
    expect(quiet.some((note) => note.voice === "pulse" || note.voice === "glint")).toBe(false);
    expect(active.some((note) => note.voice === "glint")).toBe(true);
    const ending = Array.from({ length: 16 }, (_, step) => musicNotesAt(step, 1, true)).flat();
    expect(ending).toHaveLength(3);
    expect(ending.every((note) => note.voice === "pad")).toBe(true);
});

test("saved preferences are validated and old sound modes migrate", () => {
    expect(parsePreferences(null, true, 0)).toEqual({ music: 0.1, effects: 0.5, muted: true, reducedMotion: true });
    expect(parsePreferences(null, false, 1).music).toBe(0);
    expect(parsePreferences(null, false, 2).effects).toBe(0);
    expect(parsePreferences({ music: NaN, effects: -8, muted: "false", reducedMotion: 1 }, false)).toEqual({
        music: 0.1,
        effects: 0,
        muted: false,
        reducedMotion: false,
    });
    expect(parsePreferences({ music: 7, effects: 0.35, muted: true, reducedMotion: true }, false)).toEqual({
        music: 1,
        effects: 0.35,
        muted: true,
        reducedMotion: true,
    });
    expect(parseScores([20, "100", -1, null, 99, 44, 13, 22, 32, Infinity])).toEqual([99, 44, 32, 22, 20]);
});

test("five connected creatures clear in a bent shape, including wild friends", () => {
    const grid = createEmptyGrid();
    const shape = [
        { row: 0, col: 4 },
        { row: 0, col: 5 },
        { row: 1, col: 4 },
        { row: 2, col: 4 },
        { row: 2, col: 3 },
    ];
    for (const pos of shape) grid[pos.row][pos.col].color = 2;
    grid[1][4].color = JOKER_COLOR;
    expect(checkLines(grid).toRemove.size).toBe(5);
    expect(checkLines(grid).score).toBe(12);
});

test("the fixed center is never traversed and all sixty spaces remain reachable on an empty board", () => {
    const grid = createEmptyGrid();
    expect(ALL_VALID_POSITIONS).toHaveLength(60);
    expect(isValidCell({ row: 4, col: 4 })).toBe(false);
    for (const to of ALL_VALID_POSITIONS.slice(1)) {
        const path = findPath(grid, ALL_VALID_POSITIONS[0], to);
        expect(path).not.toBeNull();
        expect(path?.every(isValidCell)).toBe(true);
    }
});
