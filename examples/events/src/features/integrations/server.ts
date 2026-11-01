import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";
import { manifest } from "../../totem/manifest.js";
import { eventsInstall, totem } from "../../totem/connection.js";

// Server functions for the integrations page. The platform lists every public app and leaves the
// choice to this app. The rule here: an app fits a port when it provides an action of the same
// name, such as HubSpot's upsertContact.

export type Port = keyof typeof manifest.needs.actions;

const isPort = (value: unknown): value is Port => typeof value === "string" && Object.hasOwn(manifest.needs.actions, value);

const PORTS = Object.keys(manifest.needs.actions).filter(isPort);

const Port = Schema.Literals(PORTS);

export const getIntegrations = createServerFn({ method: "GET" }).handler(async () => {
  const { client } = totem();
  const [apps, bound] = await Promise.all([client.apps(eventsInstall()), client.ports(eventsInstall())]);
  return PORTS.map((name) => {
    const binding = bound[name];
    const candidates = apps
      .filter((app) => name in app.actions)
      .map(({ appId, name, description }) => ({ appId, name, description }));
    // A port bound to an app that is not public still shows, so it can be disabled.
    if (binding && !candidates.some((app) => app.appId === binding.appId)) {
      candidates.push({ appId: binding.appId, name: binding.name, description: undefined });
    }
    return { port: name, description: manifest.needs.actions[name].description, binding, candidates };
  });
});

export const enable = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ port: Port, appId: Schema.NonEmptyString })))
  .handler(({ data }) => totem().client.bind(eventsInstall(), data.port, { appId: data.appId, action: data.port }));

export const disable = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ port: Port })))
  .handler(({ data }) => totem().client.unbind(eventsInstall(), data.port));

/** Returns the provider URL. The platform rejects a `returnTo` off this app's origin. */
export const connect = createServerFn({ method: "POST" })
  .validator(
    Schema.toStandardSchemaV1(Schema.Struct({ port: Port, credential: Schema.NonEmptyString, returnTo: Schema.NonEmptyString })),
  )
  .handler(({ data }) => totem().client.connect(eventsInstall(), data.port, data.credential, data.returnTo));
