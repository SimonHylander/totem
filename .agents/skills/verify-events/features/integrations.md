# Integrations

The integrations page lets a tenant choose which public app provides the CRM contact port, turn it on or off, and connect its HubSpot account.

## Sub-features

- `list-providers` shows the section `Create or update a CRM contact by email.` with a `hubspot` row and `Creates, updates and reads contacts in HubSpot CRM.`
- `disable` and `enable` unbind and bind HubSpot as the provider through the switch named `hubspot`.
- `connect` sends the user through HubSpot consent and returns to the page showing `Connected`.
- `error` shows the alert `That did not work. Please try again.` in the app's row, and the switch moves back.

## How to get to it (user POV)

- Choose the link `Integrations` on the events list.
- Open `http://localhost:3003/integrations`.

## Driving it with playwright-core

Preconditions:

- Baseline run. A fresh run already has HubSpot enabled and not connected.

- **List.** Go to `/integrations`. Expect the heading `Integrations`, the heading `Create or update a CRM contact by email.`, the checked switch `hubspot`, the text `Not connected.`, and the button `Connect`.
- **Disable.** Turn off the switch `hubspot` with `getByRole("switch", { name: "hubspot" })`. It reads unchecked, with no connect button or status.
- **Enable.** Turn on the switch. It reads checked again, and the connect state returns.
- **Connect.** This step is the user's: run `scripts/connect.sh` and ask them to press `Connect` in their own browser. Afterwards the page shows `Connected`.
- **Proof.** Save a screenshot and an ARIA snapshot of the page after each change. A registration followed by `scripts/confirm.sh` proves the binding works. A `CRM sync failed` result proves it is off (see [hubspot-sync.md](./hubspot-sync.md)).

## Gotchas

- Headless Chrome has no HubSpot login, so it cannot finish `connect`. Pressing `Connect` there only opens HubSpot's login page.
- A pending connect expires after 10 minutes. Press `Connect` again after that.
- Turning the switch off and on keeps the connection, because `ports/unbind` leaves the provider install in place. The page shows `Connected` again after the reload.
