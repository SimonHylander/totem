import { createServerFn } from "@tanstack/react-start";
import { connectOnce, eventsInstall } from "../../totem/connection.js";
import { field, port, portListings, providerAction } from "./ports.js";

export const getIntegrations = createServerFn({ method: "GET" }).handler(async () => {
  const { client } = connectOnce();
  const [apps, bound] = await Promise.all([client.apps(eventsInstall()), client.ports(eventsInstall())]);
  return portListings(apps, bound);
});

export const enable = createServerFn({ method: "POST" })
  .validator((data: unknown) => ({ port: port(data), appId: field(data, "appId") }))
  .handler(({ data }) => connectOnce().client.bind(eventsInstall(), data.port, { appId: data.appId, action: providerAction(data.port) }));

export const disable = createServerFn({ method: "POST" })
  .validator((data: unknown) => ({ port: port(data) }))
  .handler(({ data }) => connectOnce().client.unbind(eventsInstall(), data.port));

export const connect = createServerFn({ method: "POST" })
  .validator((data: unknown) => ({ port: port(data), credential: field(data, "credential"), returnTo: field(data, "returnTo") }))
  .handler(({ data }) => connectOnce().client.connect(eventsInstall(), data.port, data.credential, data.returnTo));
