# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Attendees come first. They are public visitors who open an event link, check whether seats are left, and register or join the waitlist. They have no account and no login.

Tenant admins use `/integrations` to enable, disable, and connect the apps that fill the events app's ports, such as HubSpot for `upsertContact`. Developers and buyers who evaluate Totem see the app during demos.

## Product Purpose
The events app is a demo of Totem, a framework for building AI native integration platforms. It shows a third-party app built on Totem, so it must look like a real product. A demo succeeds when an attendee registers and the registration appears as a contact in the bound CRM.

## Positioning
The events app owns none of its integrations. Its manifest declares what it provides and what it needs. The platform binds those needs to other installed apps and stores tenants and credentials. A registration syncs to HubSpot because a tenant admin bound a port on `/integrations`, not because the events app contains HubSpot code.

## Operating Context
- One deployment serves one tenant install, set by `EVENTS_INSTALL_ID`. A tenant runs many events through that install.
- `pnpm live` at the repo root starts the platform on :3000, the HubSpot app on :3002, and this app on :3003. It seeds tenant `acme` with two events: "Totem launch" (capacity 2) and "HubSpot workshop" (capacity 20).
- The UI reaches the platform only through TanStack Start server functions.

## Capabilities and Constraints
- Routes: `/` lists events with seats left. `/events/$eventId` is the public registration page. `/integrations` is the integrations marketplace (ADR 0015).
- Registration takes an email and an optional first and last name. When an event is full, new registrations join the waitlist. A result gives a seat number or a waitlist position. Registering twice returns the first result.
- A registration succeeds even when the CRM sync fails or no CRM is bound.
- The app has `checkIn` and `listAttendees` actions but no UI for them yet.
- There is no login. Anyone who can reach `/integrations` can change the tenant's integrations.
- Integration credentials are OAuth2 (the user connects through the provider) or API keys (only an admin can set them).
- Stack: TanStack Start, React 19, and Vite. The repo is Effect first (see the root `AGENTS.md`).
- Undecided: event details beyond name and capacity, such as date, location, and description. The data model does not have them yet.

## Evidence on Hand
- Event data comes from the platform at runtime. The seed provides two events.
- The repo has no logo, imagery, testimonials, or customer names for this app. Do not invent them.

## Product Principles
1. Attendees first. Keep the steps from seeing an event to registering for it to a minimum.
2. Show the real state. The UI shows seats left, waitlist position, and connection status exactly as the platform reports them.
3. The platform does the work. The UI shows that the platform binds integrations and that the app does not contain them.
4. Look like a real product. The app must look like something a company ships, so that a demo shows what an app built on Totem can be.
