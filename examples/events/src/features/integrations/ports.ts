import type { totem } from "../../totem/connection.js";
import { manifest } from "../../totem/manifest.js";

// The platform lists every public app and leaves the choice to this app. The rule here: an app fits
// a port when it provides an action of the same name, such as HubSpot's upsertContact.

export type Port = keyof typeof manifest.needs.actions;

type Client = ReturnType<typeof totem>["client"];

const isPort = (value: unknown): value is Port => typeof value === "string" && Object.hasOwn(manifest.needs.actions, value);

const PORTS = Object.keys(manifest.needs.actions).filter(isPort);

/** The action of a provider app that fills a port. */
export const providerAction = (port: Port): string => port;

/** Server functions are public endpoints, so check their input before it reaches the platform. */
export function field(data: unknown, name: string): string {
  const value = ((data ?? {}) as Record<string, unknown>)[name];
  if (typeof value !== "string" || value === "") throw new Error(`${name} is required`);
  return value;
}

export function port(data: unknown): Port {
  const value = field(data, "port");
  if (!isPort(value)) throw new Error(`no port ${value}`);
  return value;
}

/** Each port with its binding and the apps that can fill it. */
export function portListings(apps: Awaited<ReturnType<Client["apps"]>>, bound: Awaited<ReturnType<Client["ports"]>>) {
  return PORTS.map((name) => {
    const binding = bound[name];
    const candidates = apps
      .filter((app) => providerAction(name) in app.actions)
      .map(({ appId, name, description }) => ({ appId, name, description }));
    // A port bound to an app that is not public still shows, so it can be disabled.
    if (binding && !candidates.some((app) => app.appId === binding.appId)) {
      candidates.push({ appId: binding.appId, name: binding.name, description: undefined });
    }
    return { port: name, description: manifest.needs.actions[name].description, binding, candidates };
  });
}
