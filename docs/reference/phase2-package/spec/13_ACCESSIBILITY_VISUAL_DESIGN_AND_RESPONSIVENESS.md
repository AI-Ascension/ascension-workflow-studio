# 13 — Accessibility and visual quality

## Design direction

Build a restrained technical workbench, not a marketing landing page. Reuse
verified organization branding only where rights/source are clear. Use local
CSS, system font stacks and appropriately licensed icons. No generated art,
font-file redistribution, third-party analytics, remote fonts or CDN runtime.
Create a small documented token system for spacing, type hierarchy, surfaces,
borders, focus, status and light/dark/high-contrast preferences.

Status must combine text/icon/shape with color. Use clear labels for draft,
published, fixture, live, stale, unknown and needs-operator. Avoid continuous
motion; support prefers-reduced-motion and an operator pause for visual animations
without implying engine pause. Explanatory text must not pretend a disabled
control has succeeded.

## Non-canvas editing parity

Provide a semantic outline/list/table with node/edge forms, add/connect/reorder
commands, and navigation to referenced nodes. Every essential graph-authoring
operation must be possible without dragging. A keyboard alternative alone does
not replace the single-pointer alternative required for drag interactions;
include click-to-select source/target and move/alignment controls [S03].

React Flow supplies keyboard/screen-reader hooks, but the app's custom nodes,
handles, forms, panels and modal interactions need their own verification [S01].
Use labeled endpoints, focus-visible states, logical focus order, dialog focus
trap/return, announced diagnostics/save results, and node position descriptions.
Do not turn the entire workbench into an opaque role=application region.

## Target acceptance

Target WCAG 2.2 AA for shipped core journeys. Test contrast, non-text contrast,
focus visibility/not obscured, keyboard access/no traps, status announcements,
labels/names, drag alternatives, target size or permitted spacing exceptions,
zoom/reflow, and errors. The 2D graph can retain its spatial nature; surrounding
navigation/forms and the equivalent list editor must remain usable at zoom.
Manual testing is required; automated scans are not full conformance evidence [S04].

Use >=24 CSS-pixel pointer target geometry or qualifying spacing, with larger
hit areas for graph handles where feasible; verify against the current WCAG
criterion and document exceptions rather than assuming every icon qualifies.
Do not rely on hover-only content. Preserve keyboard focus after node removal,
layout, validation, tab switches and event updates. Avoid announcing every event
in a high-volume stream; offer a bounded, user-controlled status summary.

## Screen/view matrix

Capture actual application screenshots for Library (empty/populated), Designer
(strict/dynamic/nested/invalid), properties/guard builder, save conflict, publication,
Run Inspector (running/pausing/unknown/disconnected), Replay/Compare and Settings
(permission/capability failure). Include light/dark themes, 1440x900, 1280x800,
1024x768, and narrow 390x844 inspection/form views. At narrow sizes use panels/
list editing, not microscopic canvas controls. Test 200% and 400% zoom of core
navigation/forms, keyboard-only and reduced-motion.

Automated screenshot capture and human/agent visual inspection are different
activities. Inspect rendered images for clipping, overlapping controls, invisible
focus, tiny text, stale badges and unreadable contrast. Save exact build/browser/
viewport/fixture IDs with approved sanitized screenshots. Do not attach concept
mockups as implemented UI evidence.
