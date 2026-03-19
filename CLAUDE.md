# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the project

No build step required. Open `index.html` directly in a browser or serve with any static file server:

```bash
npx serve .
# or
python3 -m http.server 8080
```

MP3 files go in `tracks/`. The three predefined slots are `blue-bossa.mp3`, `autumn-leaves.mp3`, and `fly-me-to-the-moon.mp3`. The "LOAD FILE" button also accepts multiple files at once via `URL.createObjectURL()`.

## Architecture

Vanilla JS, no frameworks, no build tooling. All logic lives in `app.js` as immediately-invoked module pattern (revealing module). Modules are globals that wire together at `DOMContentLoaded`.

### Module responsibilities (`app.js`)

| Module | Role |
|---|---|
| `AudioEngine` | Wraps `HTMLAudioElement`. Handles the `AbortError` case where `play()` is called before `load()` completes — waits for `canplay` event when `readyState < 2`. |
| `TrackManager` | Holds the track array (including dynamically added local files). `addLocal()` returns the new index; `goTo(i)` sets the cursor. |
| `TonearmDrag` | All drag physics. The `.tonearm-assembly` element is a **0×0 div** positioned at the pivot point — its `left/top` from `getBoundingClientRect()` IS the pivot center. `#tonearm` has `transform-origin: 0 0`, making it rotate around that pivot. |
| `AnimationController` | Syncs CSS classes (`.playing`, `.paused`) on the vinyl, LED, and visualizer bars. |
| `UIController` | Wires DOM events: buttons, progress bar seek (mouse+touch drag), volume slider, file input, keyboard shortcuts. |
| `App` | Orchestrates all modules. Owns `isPlaying` state. |

### Tonearm rotation math (critical)

CSS `rotate(+θ)` on a **downward-pointing arm** moves the tip to the **LEFT** (clockwise on screen). The pivot is at the **upper-right** of the platter, so:

- **Negative angle** → arm tilts right → stylus **off** the record (rest position: `-20deg`)
- **Positive angle** → arm tilts left → stylus **on** the record (play position: `+22deg`)

The `mouseAngle()` formula uses `atan2(pivot.x - clientX, clientY - pivot.y)` — note the **negated X** — which maps leftward mouse movement to positive (clockwise) CSS angles, matching this geometry.

### CSS animation state machine

Vinyl spin and visualizer bars run via CSS `animation-play-state`. JS only toggles classes:

- `.vinyl.playing` → spin runs
- `.vinyl.paused` → spin freezes in place (no jump)
- `.visualizer.playing` → 16 bars animate (each has a unique `animation-duration` and `animation-delay` via `nth-child`)

The tonearm CSS transition (`1s cubic-bezier`) is suppressed (`.dragging { transition: none }`) during live drag and re-enabled after snap animations via `setTimeout`.
