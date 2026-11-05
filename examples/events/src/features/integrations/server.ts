import { createServerFn } from "@tanstack/react-start";
import { eventsInstall, totem } from "../../totem/connection.js";
import { field, port, portListings, providerAction } from "./ports.js";

export const getIntegrations = createServerFn({ method: "GET" }).handler(async () => {
  const { client } = totem();
  const [apps, bound] = await Promise.all([client.apps(eventsInstall()), client.ports(eventsInstall())]);
  return portListings(apps, bound);
});

export const enable = createServerFn({ method: "POST" })
  .validator((data: unknown) => ({ port: port(data), appId: field(data, "appId") }))
  .handler(({ data }) => totem().client.bind(eventsInstall(), data.port, { appId: data.appId, action: providerAction(data.port) }));

export const disable = createServerFn({ method: "POST" })
  .validator((data: unknown) => ({ port: port(data) }))
  .handler(({ data }) => totem().client.unbind(eventsInstall(), data.port));

/** Returns the provider URL. The platform rejects a `returnTo` off this app's origin. */
export const connect = createServerFn({ method: "POST" })
  .validator((data: unknown) => ({ port: port(data), credential: field(data, "credential"), returnTo: field(data, "returnTo") }))
  .handler(({ data }) => totem().client.connect(eventsInstall(), data.port, data.credential, data.returnTo));
