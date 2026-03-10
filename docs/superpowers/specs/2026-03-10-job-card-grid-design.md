# Job Card Grid Layout

**Date:** 2026-03-10
**Scope:** Replace the job list rows with a responsive card grid in `ui/src/App.tsx`

## Summary

Convert the jobs list from full-width rows (`display: grid; gap: 8`) to a responsive card grid using `grid-template-columns: repeat(auto-fill, minmax(270px, 1fr))`. Each card displays the same data and controls as the current row, plus status-tinted left borders.

## Card Anatomy

Each card contains (top to bottom):

1. **Header row** — drag handle (`⠿`, visible when unfiltered) + job name (truncated with ellipsis if needed) + status badge (right-aligned)
2. **Tags row** — collector type badge + up to 3 tag badges, flex-wrapped
3. **Schedule line** — cron expression in mono font
4. **URL line** — truncated with ellipsis, mono, dim color
5. **Footer** — separated by top border: last run timestamp (left) + action buttons `⏸ ✎ ✕` (right)

## Status Indicators

- **Left border:** 3px solid — `var(--success)` for active, `var(--danger)` for error, `var(--border)` for paused
- **Error cards:** also get a red-tinted overall border (`rgba(248,81,73,0.25)`)

## Responsive Behavior

Uses CSS `auto-fill` with `minmax(270px, 1fr)`:

| Viewport   | Columns |
|------------|---------|
| >1080px    | 4       |
| ~800px     | 3       |
| ~530px     | 2       |
| <530px     | 1       |

## Drag and Drop

Same HTML5 drag behavior as current implementation:
- Drag handle visible when no filters are active
- Drop indicator: accent-colored top border on target card
- Dragging card: reduced opacity (0.4)
- Disabled when search/filter is active

## Files Changed

- `ui/src/App.tsx` — rename `JobRow` to `JobCard`, change grid container from single-column to auto-fill grid, update card internals to vertical layout

## What Stays the Same

- Stats bar, filters, header, footer, modals — no changes
- All drag-and-drop state management and API calls
- All props and callbacks
- JobDetail page — unaffected
