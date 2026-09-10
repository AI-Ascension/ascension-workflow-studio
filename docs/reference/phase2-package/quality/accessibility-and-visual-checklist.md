# Manual and automated UI acceptance checklist

Record build, browser/OS, viewport/zoom, theme, input method, fixture and assessor.
Statuses start not_run; automated scan results and manual results stay separate.

| Check | Required exercise and evidence |
|---|---|
| Keyboard | Complete J02/J04/J06 with no pointer; no traps; shortcuts don't affect text fields |
| Single-pointer | Connect/move/reorder without dragging; equivalent buttons/menus available |
| Screen reader | Announce workspace, draft save state, node/port labels, errors and dialogs |
| Focus | Visible and not obscured; restored after dialogs/delete/layout/navigation |
| Structure | Semantic landmarks/headings; usable outline editor, labels, descriptions |
| Status | Live/stale/unknown/conflict/fixture meanings use text/icon, not color alone |
| Target size | Current WCAG 2.2 AA size/spacing requirements evaluated for handles/controls |
| Zoom/reflow | Navigation/forms at 200/400%; graph alternative remains usable |
| Themes | Light/dark contrast and high-contrast preference checked on actual components |
| Motion | Reduced motion, no fabricated progress, visual animation control not engine pause |
| Errors | Inline and summarized diagnostics are navigable and don't erase input |
| Temporal views | History versus live is persistent; live buttons cannot operate from history |
| Responsive | Desktop/narrow panels work without hidden essential actions or tiny text |
| Visual review | Inspect screenshots for clipping, overlap, wrong states and unreadable density |
| Automation | Run axe/browser scans on all core states; review issues, not only issue count |

Do not record a full compliance claim when manual assessment/assistive technology
was unavailable. No concept artwork or browser fixture unrelated to the candidate
counts as screenshot evidence. Store only sanitized fixtures/approved data.
