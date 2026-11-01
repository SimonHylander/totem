---
name: Events
description: A numbered sign-up sheet for public event registration, neutral and themed by one accent.
colors:
  accent: "#2f5bd3"
  accent-ink: "#ffffff"
  accent-wash: "#eff3fc"
  ground: "#ffffff"
  ink: "#18181b"
  ink-2: "#52525b"
  ink-3: "#71717a"
  line: "#e4e4e7"
  line-strong: "#18181b"
  taken: "#d4d4d8"
  danger: "#b42318"
typography:
  headline:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "clamp(1.75rem, 1.4rem + 1.6vw, 2.25rem)"
    fontWeight: 650
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tnum"
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.5
  caption:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  md: "8px"
spacing:
  gutter: "20px"
  block: "24px"
  section: "32px"
  row: "48px"
  num: "3.25rem"
  measure: "34rem"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: "50px"
    width: "100%"
  button-primary-hover:
    backgroundColor: "#2a51bb"
  field-input:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "44px"
  sheet-row:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink-3}"
    typography: "{typography.label}"
    height: "{spacing.row}"
  sheet-row-you:
    backgroundColor: "{colors.accent-wash}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    height: "{spacing.row}"
  event-row:
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    padding: "18px 0"
    height: "64px"
---

# Design System: Events

## Overview

**Creative North Star: "The Sign-up Sheet"**

Capacity is drawn as a numbered sheet. Every seat is a line with its number in a fixed column, taken lines say so, long runs collapse into one range line, and a heavy ink rule marks where capacity ends and the waitlist begins. The attendee sees exactly which line is theirs before they act, writes their email on it, and watches their name fill that same line on submit. The number never moves.

The world is neutral on purpose. A tenant themes the whole app by overriding one token, the accent, and everything else stays white ground, a zinc ink scale and hairline rules. Density is calm: one reading-width column on every viewport, 48px lines, no decoration. The visual vocabulary is rules, numbers and weight. Depth, imagery and color fields are absent.

The system covers the event list (`/`) and the registration page (`/events/$eventId`). `/integrations` is intentionally unstyled and is not yet brought into the system. Its markup carries no classes, and the stylesheet resets margins per class so that page keeps browser defaults.

**Key Characteristics:**
- One themeable accent, reserved for the attendee's own line, its number and the submit button.
- Hairline rows, one strong ink rule for boundaries.
- System sans throughout with tabular numerals in a fixed number column.
- Flat white ground. Shadows appear only as focus rings.
- One 34rem column on phone and desktop alike.

## Colors

A neutral zinc scale on white, with a single tenant accent that marks only what belongs to the attendee.

### Primary
- **Tenant Accent** (`--accent`): the attendee's own line (its 2px bottom rule and its number), the submit button, and browser surfaces: focus outline, text caret, field focus border and ring, and selection. The shipped default is a clear mid blue. Tenants override it.
- **Accent Ink** (`--accent-ink`): text on the accent, used only on the submit button.
- **Accent Wash** (`--accent-wash`): the fill behind the attendee's own line. Defined as `color-mix(in oklab, var(--accent) 7%, #ffffff)`, so it follows the tenant accent. The hex in the frontmatter is the default-theme result.

### Neutral
- **Ground** (`--ground`): page and field background.
- **Ink** (`--ink`): headlines, event names, bold counts, attendee names, input text.
- **Ink 2** (`--ink-2`): ledes, notices, the capacity rule label, sub-lines, placeholders, the admin link line.
- **Ink 3** (`--ink-3`): line numbers, "taken" states, range lines, the sync line, the "optional" hint, field hover border.
- **Line** (`--line`): hairline separators between rows and under the top bar.
- **Line Strong** (`--line-strong`): the head rule of the event list (1px) and the capacity rule (2px). Same value as Ink.
- **Taken Grey** (`--taken`): link underline at rest and the field stroke.
- **Danger** (`--danger`): the registration error line only.

### Named Rules
**The Own Line Rule.** The accent marks what belongs to the attendee: their line, its number, the button that claims it, and the browser surfaces they are acting through (focus, caret, selection). Links, hover states, counts, status lines and headings never take the accent.

**The One Token Rule.** A tenant themes the app by overriding `--accent` alone. Every accent tint (wash, selection, focus rings, button hover) is a `color-mix` of `--accent`, never a separate literal.

## Typography

**Display Font:** none. The headline uses the body family.
**Body Font:** system sans (`ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`)

**Character:** One neutral family that reads as the device's own, so the tenant accent is the only brand signal. Hierarchy comes from weight and ink step more than size.

### Hierarchy
- **Headline** (650, clamp 1.75rem to 2.25rem, 1.1, -0.02em, balanced wrap): the page title, one per page.
- **Title** (600, 1.0625rem): event names in the list and the result line after registering.
- **Body** (400, 1rem, 1.5): ledes, notices, the email input, the attendee's own number (700).
- **Label** (500, 0.875rem): field labels. The same size at 400 in Ink 3 carries line numbers, "taken", range lines and the sync line.
- **Caption** (400, 0.8125rem): the capacity rule label and the sub-line under a signed name.

### Named Rules
**The Tabular Rule.** Numerals are tabular everywhere (`font-variant-numeric: tabular-nums` on the body). Numbers sit in a fixed column: the 3.25rem number column on the sheet, a right-aligned 7.5rem minimum column on the event list.

**The Weight Not Color Rule.** Inside a neutral line, emphasis is weight 600 to 700 in Ink against 400 in Ink 2 or Ink 3 ("**20** of 20 open"). Color stays reserved for the accent.

## Layout

One column, `--measure` (34rem) wide, centered, with `--gutter` (20px) side padding, on every viewport. The top bar is 52px tall with a hairline under it and shares the same column. `main` has 32px top and 64px bottom padding. Vertical rhythm between blocks steps 8px (lede), 24px (sheet, notice, names, result), 28px (event list), 32px (admin link). The sheet uses a two-column grid: the number column (`--num`, 3.25rem) and the line content. The capacity rule aligns its label to the content column. The optional-name fields sit two-up with a 12px gap and stack to one column at 360px and below.

**The One Column Rule.** Phone and desktop render the same reading-width column. Wider viewports add margin, not columns.

## Elevation & Depth

The system is flat. There are no shadows, cards or layered surfaces. Structure comes from rules: 1px hairlines between rows, a strong ink rule for a boundary, a 2px accent rule under the attendee's own line. `box-shadow` appears only as a focus treatment.

### Shadow Vocabulary
- **Field focus ring** (`box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 22%, transparent)`): on a focused name field, together with an accent border.
- **Own-line focus** (`box-shadow: inset 0 0 0 2px color-mix(in oklab, var(--accent) 35%, transparent)`): on the attendee's line while its email input has focus.

### Named Rules
**The Ruled Sheet Rule.** Depth is never used to group or lift content. Hairlines separate, strong ink marks a boundary, and the accent rule marks ownership.

## Shapes

Lines and rules are square and run the full column width. The only rounded corners are on boxed controls, the name fields and the submit button, at a gentle 8px (`--radius`). The attendee's own line is a full-width wash band, not a box.

## Components

### Buttons
Full-width and direct. The one primary action on a page.
- **Shape:** gently rounded (8px), full column width, 50px tall, no border.
- **Primary:** Tenant Accent fill, Accent Ink label at weight 600. The label names the outcome with the number ("Take seat 1", "Join the waitlist").
- **Hover / Focus:** hover darkens to `color-mix(in oklab, var(--accent) 88%, #000000)` over 160ms with the ease-out curve. Focus uses the global 2px accent outline at 2px offset.
- **Pending:** keeps the accent fill, shows a progress cursor and "Signing you up…".
- There is no secondary button.

### Inputs / Fields
- **Style:** label above (0.875rem, 500) with an Ink 3 "optional" hint, 44px field, 1px Taken Grey stroke, 8px radius, white fill, 12px side padding.
- **Hover:** stroke moves to Ink 3.
- **Focus:** accent border plus the 3px field focus ring, no outline.
- **Error:** a single Danger line below the button (0.9375rem). Fields do not change color.
- Taken Grey on white is about 1.5:1, below the 3:1 non-text contrast target. The stroke is recorded as shipped and is not a value to copy into new controls.

### Navigation
- **Top bar:** the app name ("Events") on the list, "All events" elsewhere, weight 600, no underline, 0.9375rem, in the content column above a hairline.
- **Links:** inherit text color with a 1px Taken Grey underline offset 0.2em. Hover turns the underline to the text color.

### Event List
- A strong 1px ink head rule, then one row per event with a hairline below. Each row is a whole-row link, 64px minimum, 18px vertical padding.
- Event name in Title on the left. Count on the right in a fixed tabular column: the open number in Ink at 600, the rest in Ink 2 ("**20** of 20 open", "**Full** · waitlist open").
- Hover underlines the event name in Taken Grey.

### Sign-up Sheet (signature component)
- **Line:** 48px, number column plus content, hairline below. Taken lines show the number and "taken" in Ink 3 at 0.875rem. Open lines show only the number (with a visually hidden "open").
- **Range line:** 36px minimum, collapses a run of lines into one entry ("4–20 open", "W1–W5 taken") in the content column. Waitlist numbers carry a "W" prefix.
- **Capacity rule:** a 2px Line Strong rule with a caption label ("Capacity 20. The waitlist starts here.") in the content column. Lines below it are the waitlist.
- **Your line:** Accent Wash band with a 2px accent bottom rule. The number is accent, 1rem, 700 ("Next" when the waitlist position is unknown). Before submit it holds the email input, borderless and transparent, with the inset focus ring on the line. After submit the attendee's name is written onto the same line in 600 with a caption sub-line ("Your seat").
- **Write motion:** the name reveals left to right with `clip-path` over 520ms on `cubic-bezier(0.16, 1, 0.3, 1)`. Reduced motion removes it.

## Do's and Don'ts

### Do:
- **Do** theme a tenant by overriding `--accent` only, and derive every accent tint with `color-mix` from it.
- **Do** keep the accent on the attendee's own line, its number, the submit button and browser focus, caret and selection surfaces.
- **Do** put numbers in a fixed tabular column (3.25rem on the sheet, right-aligned 7.5rem on lists).
- **Do** separate rows with 1px `--line` hairlines and mark a real boundary with `--line-strong`.
- **Do** keep every page in the single 34rem column with 20px gutters.
- **Do** honor `prefers-reduced-motion` by removing the write reveal and the button transition.

### Don't:
- **Don't** use the accent for links, hover states, counts, headings or status text.
- **Don't** add cover images, avatars or social proof.
- **Don't** add paper texture or handwriting costume to the sheet. It is drawn with rules and numbers only.
- **Don't** put an event in a centered card with a muted seats line and a black button.
- **Don't** add shadows or cards for grouping. Box shadows are for focus only.
- **Don't** use Danger for anything except the registration error.
