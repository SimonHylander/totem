import { appClient, createHandler } from "@totem/sdk";
import { app } from "./app.js";

// Server-only wiring between this TanStack Start app and the Totem platform. The platform calls
// the app at /totem (routes/totem.ts). The UI's server functions start actions on `eventsInstall()`
// through `client`.
//   TOTEM_APP_SECRET    issued when the operator registered the app
//   TOTEM_PLATFORM_URL  the platform-methods endpoint, such as http://localhost:3000/rpc
//   EVENTS_INSTALL_ID   the tenant install this deployment's UI serves
// Built on first use, so importing this module never reads the environment in the browser.

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function connect() {
  const options = { secret: env("TOTEM_APP_SECRET"), platformUrl: env("TOTEM_PLATFORM_URL") };
  return {
    handle: createHandler(app, options),
    client: appClient(app, options),
  };
}

let connection: ReturnType<typeof connect> | undefined;

export function totem() {
  connection ??= connect();
  return connection;
}

/**
 * The tenant install whose events the UI shows. Read on use, because the platform calls /totem
 * before the install exists.
 */
export function eventsInstall(): string {
  return env("EVENTS_INSTALL_ID");
}
