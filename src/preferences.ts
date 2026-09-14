import type { AudioPreferences } from "./audio";

export interface Preferences extends AudioPreferences {
    reducedMotion: boolean;
}

export function readStored<T>(key: string, parse: (value: unknown) => T): T {
    try {
        const value = localStorage.getItem(key);
        return parse(value === null ? null : JSON.parse(value));
    } catch {
        // Private browsing / disabled storage must not prevent playing.
        return parse(null);
    }
}

export function saveStored(key: string, value: unknown) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        /* Preferences and records are optional when storage is unavailable. */
    }
}

export function parsePreferences(value: unknown, reducedMotion: boolean, legacyMode: unknown = null): Preferences {
    const fallback: Preferences = { music: 0.1, effects: 0.5, muted: false, reducedMotion };
    if (legacyMode === 0) fallback.muted = true;
    if (legacyMode === 1) fallback.music = 0;
    if (legacyMode === 2) fallback.effects = 0;
    if (!value || typeof value !== "object") return fallback;
    const volume = (input: unknown, defaultValue: number) =>
        typeof input === "number" && Number.isFinite(input) ? Math.max(0, Math.min(1, input)) : defaultValue;
    return {
        music: volume("music" in value ? value.music : undefined, fallback.music),
        effects: volume("effects" in value ? value.effects : undefined, fallback.effects),
        muted: "muted" in value && typeof value.muted === "boolean" ? value.muted : fallback.muted,
        reducedMotion:
            "reducedMotion" in value && typeof value.reducedMotion === "boolean" ? value.reducedMotion : reducedMotion,
    };
}

export function parseScores(value: unknown): number[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((item): item is number => typeof item === "number" && Number.isFinite(item) && item >= 0)
        .map(Math.floor)
        .sort((a, b) => b - a)
        .slice(0, 5);
}
