# Canvas UI Grid

Vendored from https://canvasui.dev/r/grid-react.json on 2026-11-01.
Documentation: https://canvasui.dev/docs/components/grid
Upstream: https://github.com/DavidHDev/canvas-ui
License: MIT + Commons Clause; full upstream license in LICENSE.md, distributed at /canvas-ui-license.txt.

Uses the official React/WebGL component, no extra runtime package. Local change: explanatory comment in empty capture-error catch to satisfy ESLint.

CanvasSurface scopes effects to decorative brand/hero surfaces. System reduced-motion and the persisted user toggle skip mounting the GPU component. A React error boundary preserves ordinary HTML if effect initialization throws. Unsupported HTML-in-Canvas browsers retain ordinary HTML with the official GPU overlay fallback; no origin-trial token or experimental browser flag is enabled by this integration.
