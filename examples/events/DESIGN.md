---
name: Events
description: A numbered sign-up sheet for public event registration, neutral and themed by one accent.
typography: "See /DESIGN.md for the Figtree typeface and shared weight scale."
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
typographyStyles:
  headline:
    fontFamily: '"Figtree Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: "clamp(1.75rem, 1.4rem + 1.6vw, 2.25rem)"
    fontWeight: 650
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  title:
    fontFamily: '"Figtree Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: "1.0625rem"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: '"Figtree Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tnum"
  label:
    fontFamily: '"Figtree Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.5
  caption:
    fontFamily: '"Figtree Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  md: "8px"
  pill: "13px"
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
  button-ink:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "40px"
  switch:
    backgroundColor: "{colors.ink-3}"
    width: "44px"
    height: "26px"
  switch-on:
    backgroundColor: "{colors.ink}"
---

# Design System: Events

## Overview

**Creative North Star: "The Sign-up Sheet"**

The registration page draws capacity as a numbered sheet. Every seat is a line with its number in a fixed column. Taken lines say "taken", long runs collapse into one range line, and a heavy ink rule marks where capacity ends and the waitlist begins. Before submitting, the attendee sees which line is theirs, and that line previews what they type in the form below. On submit, their name appears on the same line, and a seat's number does not change.

The design is neutral so that a tenant can theme the whole app by overriding one token, the accent. Everything else stays a white ground, a zinc ink scale, and hairline rules. Every viewport gets one reading-width column with 48px lines and no decoration. Rules, numbers, and font weight create all the structure, with no depth, imagery, or color fields.

The system covers the event list (`/`), the registration page (`/events/$eventId`), and the integrations page (`/integrations`).

**Key Characteristics:**
- One themeable accent, reserved for the attendee's own line, its number, and the submit button.
- Hairline rows, with one strong ink rule for boundaries.
- Figtree throughout, with tabular numerals in a fixed number column.
- A flat white ground. Shadows appear only as focus rings.
- One 34rem column on phone and desktop.

## Colors

A neutral zinc scale on white, with a single tenant accent that marks only what belongs to the attendee.

### Primary
- **Tenant Accent** (`--accent`): the attendee's own line (its 2px bottom rule and its number), the submit button, and these browser elements: focus outline, text caret, field focus border and ring, and selection. The default is a mid blue. Tenants override it.
- **Accent Ink** (`--accent-ink`): text on the accent, used only on the submit button.
- **Accent Wash** (`--accent-wash`): the fill behind the attendee's own line, defined as `color-mix(in oklab, var(--accent) 7%, #ffffff)`, so it follows the tenant accent. The hex in the frontmatter is the result for the default accent.

### Neutral
- **Ground** (`--ground`): page and field background.
- **Ink** (`--ink`): headlines, event names, bold counts, attendee names, and input text.
- **Ink 2** (`--ink-2`): ledes, notices, the capacity rule label, sub-lines, the line preview, port labels, app descriptions, event-list counts, and the top bar's Integrations link at rest.
- **Ink 3** (`--ink-3`): line numbers, "taken" states, range lines, the sync line, the "optional" hint, the integrations caption, the switch when off, and the field hover border.
- **Line** (`--line`): hairline separators between rows and under the top bar.
- **Line Strong** (`--line-strong`): the head rule of the event list and of each port (1px), and the capacity rule (2px). It has the same value as Ink.
- **Taken Grey** (`--taken`): the link underline at rest and the field stroke.
- **Danger** (`--danger`): the error line when a registration or an integration change fails.

### Named rules
**The Own Line Rule.** The accent marks what belongs to the attendee: their line, its number, the button that claims it, and the browser focus, caret, and selection. Links, hover states, counts, status lines, and headings never use the accent.

**The One Token Rule.** A tenant themes the app by overriding `--accent` alone. Every accent tint (wash, selection, focus rings, and button hover) is a `color-mix` of `--accent`, never a separate literal.

## Typography

> **Shared tokens:** See [`/DESIGN.md`](/DESIGN.md) for the Figtree typeface, weight scale, OpenType features, and licensing rules. This section covers how this app uses them.

**Typeface:** Figtree Variable, self-hosted through `@fontsource-variable/figtree` (latin and latin-ext subsets).
**Fallback stack:** `"Figtree Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`

**Character:** A geometric sans that stays neutral, so the tenant accent is the only brand signal. Hierarchy comes from weight and ink step more than from size.

### Hierarchy
- **Headline** (650, clamp 1.75rem to 2.25rem, 1.1, -0.02em, balanced wrap): the page title, one per page.
- **Title** (600, 1.0625rem): event names in the list, app names, and the result line after registering.
- **Body** (400, 1rem, 1.5): ledes, notices, field input text, the line preview, and the attendee's own number (700).
- **Label** (500, 0.875rem): field labels. The same size at 400 in Ink 3 sets line numbers, "taken", range lines, and the sync line.
- **Caption** (400, 0.8125rem): the capacity rule label, the sub-line under a signed name, and the integrations caption.

### Named rules
**The Tabular Rule.** Numerals are tabular everywhere (`font-variant-numeric: tabular-nums` on the body). Numbers sit in a fixed column: the 3.25rem number column on the sheet, and a right-aligned column with a 7.5rem minimum on the event list.

**The Weight Not Color Rule.** Inside a neutral line, emphasis is weight 600 to 700 in Ink against 400 in Ink 2 or Ink 3 ("**20** of 20 open"). Color stays reserved for the accent.

## Layout

Every viewport gets one centered column, `--measure` (34rem) wide, with `--gutter` (20px) side padding. The top bar is 52px tall with a hairline under it and uses the same column. `main` has 32px top padding and 64px bottom padding. The space above a block is 8px for the lede, 16px for the name fields, 24px for the sheet, notice, email field, and result, and 28px for the event list. The sheet is a two-column grid of the number column (`--num`, 3.25rem) and the line content. The capacity rule aligns its label to the content column. The optional name fields sit side by side with a 12px gap and stack into one column at 360px and below.

**The One Column Rule.** Phone and desktop render the same reading-width column. Wider viewports add margin, not columns.

## Elevation & Depth

The system is flat, with no shadows, cards, or layers. Rules create the structure: 1px hairlines between rows, a strong ink rule for a boundary, and a 2px accent rule under the attendee's own line. `box-shadow` appears only on focused fields.

### Shadow vocabulary
- **Field focus ring** (`box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 22%, transparent)`): on a focused field, together with an accent border.

### Named rules
**The Ruled Sheet Rule.** Never use depth to group or lift content. Hairlines separate, strong ink marks a boundary, and the accent rule marks ownership.

## Shapes

Lines and rules are square and run the full column width. Only boxed controls have rounded corners: the form fields and buttons at 8px (`--radius`), and the integrations switch, a 13px pill. The attendee's own line is a full-width wash band, not a box.

## Components

### Buttons
The full-width submit button is the one primary action on a page.
- **Shape:** 8px radius, full column width, 50px tall, and no border.
- **Primary:** Tenant Accent fill, with an Accent Ink label at weight 600. The label names the outcome and, for a seat, its number ("Take seat 1", "Join the waitlist").
- **Hover and focus:** Hover darkens the fill to `color-mix(in oklab, var(--accent) 88%, #000000)` over 160ms with the ease-out curve. Focus uses the global 2px accent outline at a 2px offset.
- **Pending:** The button keeps the accent fill, shows a progress cursor, and reads "Signing you up…".
- **Ink:** The Connect button on `/integrations`, sized to its label. It is 40px tall, with an Ink fill, a Ground label at weight 600, and an 8px radius. It uses Ink because the accent belongs to the attendee.

### Inputs and fields
- **Order:** Email comes first at full column width with no hint, because it is the one required field. First name and last name follow side by side with the "optional" hint.
- **Style:** The label sits above the field (0.875rem, 500), with an Ink 3 "optional" hint on optional fields. The field is 44px tall, with a 1px Taken Grey stroke, an 8px radius, a white fill, and 12px side padding.
- **Hover:** The stroke changes to Ink 3.
- **Focus:** An accent border plus the 3px field focus ring, with no outline.
- **Error:** One Danger line below the button (0.9375rem). Fields do not change color.
- **Contrast:** Taken Grey on white is about 1.5:1, below the 3:1 non-text contrast target. This file records the stroke as shipped. Do not copy the value into new controls.

### Navigation
- **Top bar:** The app name ("Events") on the list and "All events" elsewhere, at weight 600 and 0.9375rem with no underline, in the content column above a hairline. "Integrations" sits at the right end on every page, in Ink 2 with no underline. Hover changes it to Ink. On its own page it is Ink at weight 600.
- **Links:** Links inherit the text color and have a 1px Taken Grey underline, offset 0.2em. Hover changes the underline to the text color.

### Event list
- A strong 1px ink head rule, then one row per event with a hairline below. Each row is a whole-row link, 64px minimum, with 18px vertical padding.
- The event name is in Title on the left. The count is on the right in a fixed tabular column, with the open number in Ink at 600 and the rest in Ink 2 ("**20** of 20 open", "**Full** · waitlist open").
- Hover underlines the event name in Taken Grey.

### Integrations
- **Port label:** The port's description at 0.875rem in Ink 2, above a strong 1px ink rule, then one row per app with a hairline below.
- **App row:** The app name in Title and its description at 0.875rem in Ink 2 on the left, and the switch on the right. Once the app is on, a status line sits under the description: "**Connected**", "**Needs an API key** from an admin.", or "**Not connected.**" with the consequence and an ink Connect button. Emphasis follows the Weight Not Color Rule.
- **Switch:** 44 by 26px with a 44px touch target. It is Ink 3 when off and Ink when on, with a white 20px knob. When pressed, it moves over 160ms, and it moves back if the change fails. Turning it off needs no confirmation, because the platform keeps the provider install and its credential.
- **More than one app:** A port holds one app, so turning one on turns off the current one. A caption under the list says so when a port has more than one app.

### Sign-up sheet (signature component)
- **Line:** 48px tall, with the number column, the content, and a hairline below. Taken lines show the number and "taken" in Ink 3 at 0.875rem. Open lines show only the number, with a visually hidden "open".
- **Range line:** 36px minimum. It collapses a run of lines into one entry in the content column ("4–20 open", "W1–W5 taken"). Waitlist numbers have a "W" prefix.
- **Capacity rule:** A 2px Line Strong rule with a caption label in the content column ("Capacity 20. The waitlist starts here."). Lines below it are the waitlist.
- **Your line:** An Accent Wash band with a 2px accent bottom rule. The number is accent, 1rem, and 700 ("Next" when the waitlist position is unknown). Before the attendee types, the line shows "Your seat" ("Your place" on the waitlist) in Ink 2 at 0.875rem. As they type, it shows their name in Ink 2 at 1rem, or their email when they give no name. This preview stays on one line, truncates with an ellipsis, and is hidden from screen readers. After submit, the line shows the name or email at weight 600, with a caption sub-line ("Your seat" or "Your place on the waitlist").
- **Write motion:** The name appears left to right through `clip-path` over 520ms on `cubic-bezier(0.16, 1, 0.3, 1)`. Reduced motion removes the animation.

## Do's and Don'ts

### Do:
- **Do** theme a tenant by overriding `--accent` only, and derive every accent tint from it with `color-mix`.
- **Do** keep the accent on the attendee's own line, its number, the submit button, and browser focus, caret, and selection.
- **Do** put numbers in a fixed tabular column (3.25rem on the sheet, right-aligned 7.5rem on lists).
- **Do** separate rows with 1px `--line` hairlines and mark a real boundary with `--line-strong`.
- **Do** keep every page in the single 34rem column with 20px gutters.
- **Do** honor `prefers-reduced-motion` by removing the write reveal and the button and switch transitions.

### Don't:
- **Don't** use the accent for links, hover states, counts, headings, or status text.
- **Don't** add cover images, avatars, or social proof.
- **Don't** add paper texture or handwriting fonts to the sheet. Draw it with rules and numbers only.
- **Don't** put an event in a centered card with a muted seats line and a black button.
- **Don't** add shadows or cards for grouping. Box shadows are for focus only.
- **Don't** use Danger for anything except a failed registration or integration change.
