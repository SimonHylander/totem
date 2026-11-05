import { appClient, createHandler } from "@totem/sdk";
import { app } from "./app.js";

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

export function connectOnce() {
  connection ??= connect();
  return connection;
}

export function eventsInstall(): string {
  return env("EVENTS_INSTALL_ID");
}
