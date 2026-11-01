---
version: 1
slug: "src-routes-events-eventid-tsx"
primary_target: "src/features/registration/RegistrationPage.tsx"
related_targets: ["src/features/events/EventList.tsx"]
---

# Attendee registration

Scope: `/` (event list) and `/events/$eventId` (registration). Mode: Operate. Build path: code-led.

Audience: public attendees from a shared link, mostly on phones, no account. Task: see whether there is room, claim a seat or waitlist place. Proof: every number comes from the platform (capacity, seatsLeft, register position). A quiet "Synced to CRM" line shows when crmContactId is present.

Constraints: neutral and themeable (one `--accent` token). No cover images, avatars, social proof, or paper costume. `/integrations`, server functions and the data model stay untouched.

Open: whether the sync line names the bound app (needs a ports() call). Default is the generic line.

## Direction contract

THESIS: Capacity is a numbered sign-up sheet. You take the next empty line, and the waitlist starts below a heavy rule. Refuses the centered event card with a muted seats line and a black button.

OWN-WORLD: White ground, neutral ink scale, hairline row rules, one heavy ink rule for capacity. System sans with tabular numerals in a fixed number column. One themeable accent, used only on the attendee's own line, its number and the submit button.

STORY: The attendee sees the event, sees exactly where they would land, watches their line preview what they type, and sees that line fill with their name on submit.

FIRST VIEWPORT: Phone. Back link bar, event name, "6 of 20 open" line, then the sheet window: first taken line, collapsed taken range, last taken lines, your line in accent previewing the form, two open lines, collapsed open range, the waitlist rule. The email field, the optional names and the submit button follow directly under the sheet.

FORM: Sign-up Sheet, position 1 on the ordered list (IMPECCABLE'S PICK). seed:0500511e7533d0bb. Signature move: submit fills your line in place, number unmoved.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
