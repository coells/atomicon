# Atomicon

A hexagonal puzzle about connecting five creatures of the same kind. Groups can have any shape. Rainbow creatures are wild; the center is blocked. Moves without a match add new creatures.

## Run locally

Requires Node.js 20.19+ (or 22.12+) and pnpm 10.

```sh
pnpm install
pnpm dev
```

## Check changes

```sh
pnpm exec playwright install chromium webkit
pnpm typecheck
pnpm test
pnpm test:production
pnpm format:check
pnpm build
```

Tests cover desktop Chromium and phone-emulated Chromium and WebKit, including full games, scoring, restart cancellation, keyboard controls, preferences, audio suspension, and crossfades between the two recorded music tracks. Screenshots and failure traces go to `test-results/`.

`pnpm test:production` builds and smoke-tests the deployed asset paths. `pnpm preview` serves the production build at `/atomicon/`, the existing GitHub Pages base path.

## Controls

- Click or tap a creature, then an empty destination. A clear path is required.
- Hover over an empty destination to preview the path.
- Use arrow keys on the focused board to navigate, and Enter or Space to select. Escape deselects.
- Tap the music icon or press M to mute. The gear opens inline volume and motion controls.
- The restart arrow asks for inline confirmation. Settings and confirmation expand above the bottom toolbar. Nothing covers or locks the board.

Preferences, best scores, and the five-entry leaderboard stay in local storage. Audio starts after an interaction and suspends when the page is hidden or fully muted.

## Presentation and audio

The original hexagonal board fills phone width, bounded by available height in landscape. There is no circular frame. The default screen shows large scores, upcoming characters, and three icon controls. Move feedback remains available to screen readers without filling the screen with text.

The supplied character artwork is packed into one transparent WebP atlas. Sandstone replaces Water so Ice is the only blue character. Sprite padding accounts for the full silhouette and animation bounds. The supplied elemental background is static; eight small CSS motes drift over it.

The board renders at up to 20 fps at rest and 30 fps during transitions, with capped particles and a maximum 2× pixel ratio. Characters breathe gently. Only one character is eligible for a short wiggle every 28 seconds and a faint glint every 41 seconds. Reduced motion disables ambient movement and stops idle canvas rendering. Hidden pages stop canvas work, CSS animations, and audio playback.

`track1.m4a` and `track2.m4a` alternate with eight-second equal-power crossfades, including the return to track1. Two media elements stream AAC rather than decoding whole songs into JavaScript audio buffers. Defaults are 10% music and 50% effects; saved choices are preserved. Effects-only audio suspends after seven seconds of inactivity.

Browser checks exercise touch input, phone layouts, audio overlap and suspension. They do not measure physical-device battery life.

## Regenerate supplied assets

Original images and music are preserved under `art/`. With uv installed:

```sh
uv run scripts/prepare_characters.py
uv run scripts/prepare_music.py
```

The image script normalizes transparent sprites, builds the atlas and a contact sheet, and compresses the background. The music script converts the supplied Opus-in-M4A files to AAC-in-M4A for Safari compatibility and trims leading near-silence. Both scripts pin their own dependencies.

- `src/game.ts`: original board, matching, pathfinding, and scoring rules.
- `src/renderer.ts`: board materials, creature sprites, path previews, and effects.
- `src/main.ts`: turns, inline controls, and frame scheduling.
- `src/characters.ts`: atlas loading and character identities.
- `src/playlist.ts`: streaming music and crossfade lifecycle.
- `src/music.ts`: legacy score and synthesis helpers (not the active soundtrack).
- `src/synth.ts`: synthesized board sound effects.
- `src/audio.ts`: audio graph, scheduling, volume, and lifecycle.
- `src/preferences.ts`: saved-data validation and legacy sound-mode migration.
- `src/style.css`: responsive layout and interface styling.

The UI uses system fonts and makes no third-party requests. Previously bundled font assets and their licenses remain in `public/fonts/` but are not loaded.
