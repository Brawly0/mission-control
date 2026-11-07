# 0038: Generated artwork for icon, empty states and backgrounds

Date: 2026-11-07

## Context

The user asked to use Codex to create images and icons that make the app more appealing. They chose all four kinds offered (empty-state illustrations, a new app icon, a Home hero banner and a subtle background) and asked for the style of the existing `build/icon.svg`: navy with cyan, blue and violet glow.

## Decision

- The art was made with Codex CLI's built-in image generation (`codex exec`, with `build/icon.png` attached as the style reference) and checked by eye before use. Images contain no text.
- Renderer assets are in `src/renderer/src/art/` as WebP files: empty states at 320px with alpha, the hero banner at 1536px, the background at 1280px and the sidebar mark at 128px, about 120 KB in total.
- `EmptyState` (in `components/ui.tsx`) picks an illustration from the lucide icon it already receives, via `emptyArt.ts`. Icons with no entry keep the plain icon tile, so no call site changed. The two Home panel empty states use the art directly.
- `art.css` puts the hero banner behind `.hd-hero` and the texture behind `.main`, in the dark theme only, because the art is painted on navy. Empty-state art appears in both themes and floats gently unless reduced motion is set.
- The app icon: `build/icon-master.png` (1024px) is the generated source, and `build/icon.png` (512px) is a downscale of it used by electron-builder, the window, the tray and notifications. The sidebar `BrandMark` now uses `art/app-mark.webp` so it matches. `build/icon.svg` stays as the old vector. Running `npm run icon` would overwrite `icon.png` with the flat SVG render, and the script carries a note about this.

## Alternatives

- Generated raster images for the small UI icons: lucide's vector icons are sharper at 14–24px and already follow the theme colors, so they stay.
- Adding an `art` prop at every `EmptyState` call site: more edits for the same result.
