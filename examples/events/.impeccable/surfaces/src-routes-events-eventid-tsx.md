---
version: 1
slug: "src-routes-events-eventid-tsx"
primary_target: "src/features/registration/RegistrationPage.tsx"
related_targets: ["src/features/events/EventList.tsx"]
---

# Attendee registration

Scope: `/` (event list) and `/events/$eventId` (registration). Mode: Operate. Build path: code-led.

Audience: public attendees who arrive from a shared link, mostly on phones, with no account. Task: see whether there is room, then claim a seat or a waitlist place. Proof: every number comes from the platform (`capacity`, `seatsLeft`, and the `position` that `register` returns). A small "Synced to CRM" line appears when `crmContactId` is present.

Constraints: neutral and themeable with one `--accent` token. No cover images, avatars, social proof, or paper effects. This work does not change `/integrations`, the server functions, or the data model.

Open: whether the sync line names the bound app, which needs a `ports()` call. The default is the generic line.

## Direction contract

THESIS: Capacity is a numbered sign-up sheet. You take the next empty line, and the waitlist starts below a heavy rule. The design rejects the centered event card with a muted seats line and a black button.

OWN-WORLD: White ground, a neutral ink scale, hairline row rules, and one heavy ink rule for capacity. Figtree with tabular numerals in a fixed number column. One themeable accent, used only on the attendee's own line, its number, and the submit button.

STORY: The attendee sees the event, sees which line they would get, watches that line preview what they type, and sees their name on that line after submit.

FIRST VIEWPORT: Phone. The top bar with its link back to the list, the event name, the "6 of 20 seats open" line, then the sheet: the first taken line, a collapsed taken range, the last taken line, your line in accent previewing the form, two open lines, a collapsed open range, and the capacity rule. The email field, the optional names, and the submit button follow directly under the sheet.

FORM: Sign-up Sheet, position 1 on the ordered list (IMPECCABLE'S PICK). seed:0500511e7533d0bb. Signature move: submit fills your line in place, and the number stays the same.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
