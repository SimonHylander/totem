import { useState } from "react";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { manifest } from "../manifest.js";
import { eventsInstall, totem } from "../totem.js";

// The integrations marketplace for the tenant install this deployment serves. It lists the public
// apps that can fill each port and lets the user enable, disable and connect them (ADR 0015). There
// is no login yet, so anyone who can reach this page can change the tenant's integrations.
//
// The platform lists every public app and leaves the choice to this app. The rule here: an app fits
// a port when it provides an action of the same name, such as HubSpot's upsertContact.

type Port = keyof typeof manifest.needs.actions;

const isPort = (value: unknown): value is Port => typeof value === "string" && Object.hasOwn(manifest.needs.actions, value);

const PORTS = Object.keys(manifest.needs.actions).filter(isPort);

/** Server functions are public endpoints, so check their input before it reaches the platform. */
function field(data: unknown, name: string): string {
  const value = ((data ?? {}) as Record<string, unknown>)[name];
  if (typeof value !== "string" || value === "") throw new Error(`${name} is required`);
  return value;
}

function port(data: unknown): Port {
  const value = field(data, "port");
  if (!isPort(value)) throw new Error(`no port ${value}`);
  return value;
}

const getIntegrations = createServerFn({ method: "GET" }).handler(async () => {
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

const enable = createServerFn({ method: "POST" })
  .validator((data: unknown) => ({ port: port(data), appId: field(data, "appId") }))
  .handler(({ data }) => totem().client.bind(eventsInstall(), data.port, { appId: data.appId, action: data.port }));

const disable = createServerFn({ method: "POST" })
  .validator((data: unknown) => ({ port: port(data) }))
  .handler(({ data }) => totem().client.unbind(eventsInstall(), data.port));

/** Returns the provider URL. The platform rejects a `returnTo` off this app's origin. */
const connect = createServerFn({ method: "POST" })
  .validator((data: unknown) => ({ port: port(data), credential: field(data, "credential"), returnTo: field(data, "returnTo") }))
  .handler(({ data }) => totem().client.connect(eventsInstall(), data.port, data.credential, data.returnTo));

export const Route = createFileRoute("/integrations")({
  loader: () => getIntegrations(),
  errorComponent: () => <p>Integrations could not be loaded.</p>,
  component: Integrations,
});

function Integrations() {
  const ports = Route.useLoaderData();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  /** Run one change, then reload the list. */
  const run = async (change: () => Promise<unknown>) => {
    setPending(true);
    setFailed(false);
    try {
      await change();
      await router.invalidate();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };

  const startConnect = (port: Port, credential: string) =>
    run(async () => window.location.assign(await connect({ data: { port, credential, returnTo: window.location.href } })));

  return (
    <main>
      <p>
        <Link to="/">All events</Link>
      </p>
      <h1>Integrations</h1>
      {failed && <p role="alert">That did not work. Please try again.</p>}
      {ports.map(({ port, description, binding, candidates }) => (
        <section key={port}>
          <h2>{description}</h2>
          {candidates.length === 0 && <p>No app offers this yet.</p>}
          <ul>
            {candidates.map((app) => {
              const enabled = binding?.appId === app.appId;
              const credentials = enabled ? Object.entries(binding.credentials) : [];
              return (
                <li key={app.appId}>
                  <strong>{app.name}</strong>
                  {app.description && ` · ${app.description}`}{" "}
                  <button
                    disabled={pending}
                    onClick={() => run(() => (enabled ? disable({ data: { port } }) : enable({ data: { port, appId: app.appId } })))}
                  >
                    {enabled ? "Disable" : "Enable"}
                  </button>
                  {credentials.map(([name, { type, connected }]) =>
                    connected ? (
                      <span key={name}> · {name} connected</span>
                    ) : type === "oauth2" ? (
                      <button key={name} disabled={pending} onClick={() => startConnect(port, name)}>
                        Connect {name}
                      </button>
                    ) : (
                      <span key={name}> · {name} needs an API key from an admin</span>
                    ),
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </main>
  );
}
