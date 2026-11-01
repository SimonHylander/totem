# Totem Design System

The repo-wide design source of truth. Individual apps may extend these tokens with app-specific values, but must reference this document for shared typography, color philosophy, and licensing rules.

## Typography

### Typeface: Figtree

**Figtree** is the Totem typeface: a clean, friendly geometric sans serif that reads as modern and approachable without imposing a heavy brand personality. The variable font covers weights 300–900 with matching italics.

- **Source:** [Figtree on Google Fonts](https://fonts.google.com/specimen/Figtree)
- **Designer:** Erik Kennedy
- **License:** SIL Open Font License 1.1 (OFL-1.1)

### Self-Hosting

Totem apps self-host Figtree via `@fontsource-variable/figtree`. Do not use Google Fonts CDN or other external font services.

```bash
pnpm add @fontsource-variable/figtree
```

Import both the upright and italic axes:

```typescript
import "@fontsource-variable/figtree";
import "@fontsource-variable/figtree/wght-italic.css";
```

### CSS Custom Property

```css
--font: "Figtree Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
```

The stack starts with `"Figtree Variable"` (the family name used by fontsource), then falls back through system UI fonts if Figtree hasn't loaded yet.

### Font Loading

- **Subsets:** latin, latin-ext (covers Western European, Nordic å/ä/ö, and extended Latin scripts)
- **`font-display`:** swap (text remains visible during load with fallback, then swaps to Figtree)

The fontsource package uses `font-display: swap` by default.

### Size-Adjusted Fallback (Optional)

For apps where layout shift must be minimized, define a local fallback face with size-adjust:

```css
@font-face {
  font-family: "Figtree Fallback";
  src: local("Segoe UI"), local("Roboto"), local("Helvetica Neue"), local("Arial");
  size-adjust: 100.5%;
  ascent-override: 95%;
  descent-override: 22%;
  line-gap-override: 0%;
}

:root {
  --font: "Figtree Variable", "Figtree Fallback", ui-sans-serif, system-ui, sans-serif;
}
```

The metrics above are approximate; tune them per app if CLS is critical.

### Weight Scale

Figtree's variable axis spans 300–900. The Totem hierarchy uses:

| Role     | Weight | Notes                                           |
| -------- | ------ | ----------------------------------------------- |
| Headline | 650    | Rendered via variable axis, not a named weight  |
| Title    | 600    | Semi-bold, event names and result lines         |
| Body     | 400    | Regular text, ledes, notices, inputs            |
| Label    | 500    | Form labels, medium emphasis                    |
| Caption  | 400    | Supplementary text at smaller sizes             |
| Bold     | 700    | Inline emphasis within body text                |

Intermediate weights like 650 work because Figtree is a variable font with a continuous `wght` axis.

### OpenType Features

Figtree includes the following OpenType features:

- **Tabular figures (`tnum`):** Equal-width digits for alignment in tables and number columns.
- **Fractions (`frac`):** Builds proper fractions from sequences like `1/2`.
- **Stylistic sets:** `ss01` (single-storey a), `ss02` (alternate I/l/0).
- **Ordinals, subscript, superscript**

### Typography Rules

**The Tabular Rule.** Numerals are tabular everywhere (`font-variant-numeric: tabular-nums` on body). Numbers sit in fixed-width columns: seat numbers on a sheet, counts on a list.

**The Weight Not Color Rule.** Inside neutral text, hierarchy comes from weight (600–700 against 400) and ink step, not color. Color is reserved for the tenant accent.

## Color Philosophy

**Tenant accent is the only brand signal.** Apps ship with a default accent but let tenants override it with one token (`--accent`). All derived tints (wash, selection, focus rings, button hover) are computed from `--accent` via `color-mix()`, never stored as separate literals.

The neutral palette is a zinc scale on white ground. See individual app DESIGN.md files for the complete color tokens.

## Licensing

**Only self-hostable, open-licensed fonts are permitted.** Acceptable licenses:

- SIL Open Font License (OFL-1.1)
- Apache License 2.0
- Ubuntu Font License

When adding a font, retain the license notice. For Figtree:

> Copyright 2022 The Figtree Project Authors (https://github.com/erikdkennedy/figtree)  
> Licensed under the SIL Open Font License, Version 1.1.
