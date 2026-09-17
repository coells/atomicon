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

Tests cover desktop Chromium and touch-emulated Chromium and WebKit at phone and tablet sizes. They include full games, scoring, restart cancellation, keyboard controls, preferences, particle variation, visual feedback, idle canvas sleep, audio suspension, and crossfades between the two recorded music tracks. Screenshots and failure traces go to `test-results/`.

`pnpm test:production` builds and smoke-tests the deployed asset paths. `pnpm preview` serves the production build at `/atomicon/`, the existing GitHub Pages base path.

## Controls

- Click or tap a creature, then an empty destination. A clear path is required.
- Hover over an empty destination to preview the path. Tapping a valid destination lights the route during movement; no hover is required.
- Selecting a creature shows a short greeting and a steady halo. An unreachable destination fades amber without clearing the selection.
- Use arrow keys on the focused board to navigate, and Enter or Space to select. Escape deselects.
- Tap the music icon or press M to mute. The gear opens inline volume and motion controls.
- The restart arrow asks for inline confirmation. Settings and confirmation expand above the bottom toolbar. Nothing covers or locks the board.

Preferences, best scores, and the five-entry leaderboard stay in local storage. Audio starts after an interaction and suspends when the page is hidden or fully muted.

## Presentation and audio

The original hexagonal board fills phone width, bounded by available height in landscape. There is no circular frame. The default screen shows large scores, upcoming characters, and three icon controls. Move feedback remains available to screen readers without filling the screen with text.

The supplied character artwork is packed into one transparent WebP atlas. Sandstone replaces Water so Ice is the only blue character. Sprite padding accounts for the full silhouette and animation bounds. The supplied elemental background is static; eight small CSS motes drift over it.

Energy use takes priority over continuous animation. The canvas sleeps at rest, including while a creature is selected. Effects run at up to 30 fps with a maximum 2× pixel ratio. The center atom advances only while the board is already animating; pointer movement does not drive its clock. Hidden pages stop canvas work, CSS animations, and audio playback.

Selection greetings last 320 ms; rejected destinations fade over 420 ms. Route and destination feedback reuse the movement frames. Clears keep the connecting lightning, add a small bounce and fade, and resume play after 620 ms. A decorative glow finishes within about one second of the clear starting. Each clear has at most 96 elemental particles, with independent curves and a separate drift for each creature. Shapes and halos are cached; randomness is sampled before drawing rather than on every frame. Reduced motion removes greetings and moving particles, uses steady route markers, and keeps opacity-only clear and rejection feedback.

`track1.m4a` and `track2.m4a` alternate with eight-second equal-power crossfades, including the return to track1. Two media elements stream AAC rather than decoding whole songs into JavaScript audio buffers. Defaults are 10% music and 50% effects; saved choices are preserved. Effects-only audio suspends after seven seconds of inactivity.

Browser checks exercise touch input, phone layouts, audio overlap and suspension. Audio-policy tests also cover tap-completion unlock and recovery from an interrupted context. Playwright's mobile WebKit profile does not run iOS itself: verify audible music and effects on a physical iPhone or iPad, including after app switching and with Silent Mode on and off. These tests do not measure physical-device battery life.

## Regenerate supplied assets

Original images and music are preserved under `art/`. With uv installed:

```sh
uv run scripts/prepare_characters.py
uv run scripts/prepare_music.py
```

The image script normalizes transparent sprites, builds the atlas and a contact sheet, and compresses the background. The music script converts the supplied Opus-in-M4A files to AAC-in-M4A for Safari compatibility and trims leading near-silence. Both scripts pin their own dependencies.

- `src/game.ts`: original board, matching, pathfinding, and scoring rules.
- `src/renderer.ts`: board materials, creature sprites, touch feedback, path previews, and effects.
- `src/connection-effect.ts`: match timing, lightning, particle trajectories, and afterglow.
- `src/element-particles.ts`: cached elemental particle shapes and motion.
- `src/main.ts`: turns, inline controls, and frame scheduling.
- `src/characters.ts`: atlas loading and character identities.
- `src/playlist.ts`: streaming music and crossfade lifecycle.
- `src/music.ts`: legacy score and synthesis helpers (not the active soundtrack).
- `src/synth.ts`: synthesized board sound effects.
- `src/audio.ts`: audio graph, scheduling, volume, and lifecycle.
- `src/preferences.ts`: saved-data validation and legacy sound-mode migration.
- `src/style.css`: responsive layout and interface styling.

The UI uses system fonts and makes no third-party requests. Previously bundled font assets and their licenses remain in `public/fonts/` but are not loaded.
