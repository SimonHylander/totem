import { appClient, createHandler } from "@totem/sdk";
import { app } from "./app.js";

// The server-only connection between this TanStack Start app and the Totem platform.
//   TOTEM_APP_SECRET    issued when the operator registered the app
//   TOTEM_PLATFORM_URL  the platform-methods endpoint, such as http://localhost:3000/rpc
//   EVENTS_INSTALL_ID   the tenant install that this deployment's UI serves
// `totem()` builds the connection on first use, so importing this module does not read the
// environment in the browser.

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
 * The tenant install whose events the UI shows. This function reads the variable on each call,
 * because the platform calls `/totem` before the install exists.
 */
export function eventsInstall(): string {
  return env("EVENTS_INSTALL_ID");
}
