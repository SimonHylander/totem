# Integrations

The integrations page lets a tenant choose which public app provides the CRM contact port, turn it on or off, and connect its HubSpot account.

## Sub-features

- `list-providers` shows the section `Create or update a CRM contact by email.` with `hubspot · Creates, updates and reads contacts in HubSpot CRM.`
- `disable` and `enable` unbind and bind HubSpot as the provider. The button toggles between `Disable` and `Enable`.
- `connect` sends the user through HubSpot consent and returns to the page showing ` · hubspot connected`.
- `error` shows the alert `That did not work. Please try again.`

## How to get to it (user POV)

- Choose the link `Integrations` on the events list.
- Open `http://localhost:3003/integrations`.

## Driving it with playwright-core

Preconditions:

- Baseline run. A fresh run already has HubSpot enabled and not connected.

- **List.** Go to `/integrations`. Expect the heading `Integrations`, the heading `Create or update a CRM contact by email.`, and the buttons `Disable` and `Connect hubspot`.
- **Disable.** Choose `Disable`. The page reloads with the button `Enable` and no connect button or status.
- **Enable.** Choose `Enable`. The button reads `Disable` again, and the connect state returns.
- **Connect.** This step is the user's: run `scripts/connect.sh` and ask them to press `Connect hubspot` in their own browser. Afterwards the page shows ` · hubspot connected`.
- **Proof.** Save a screenshot and an ARIA snapshot of the page after each change. A registration followed by `scripts/confirm.sh` proves the binding works. A `CRM sync failed` result proves it is off (see [hubspot-sync.md](./hubspot-sync.md)).

## Gotchas

- Headless Chrome has no HubSpot login, so it cannot finish `connect`. Pressing `Connect hubspot` there only opens HubSpot's login page.
- A pending connect expires after 10 minutes. Press `Connect hubspot` again after that.
- It is not known whether `Disable` followed by `Enable` keeps the HubSpot connection. Check the page for ` · hubspot connected` before relying on it.
