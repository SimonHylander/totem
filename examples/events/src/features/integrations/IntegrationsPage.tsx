import { useState } from "react";
import { getRouteApi, useRouter } from "@tanstack/react-router";
import { connect, disable, enable, type getIntegrations } from "./server.js";

// There is no login yet, so anyone who can reach this page can change the tenant's integrations (ADR 0015).

const route = getRouteApi("/integrations");

type Listing = Awaited<ReturnType<typeof getIntegrations>>[number];

type Change = { kind: "on" | "off"; appId: string } | { kind: "connect"; appId: string; credential: string };

export function IntegrationsPage() {
  const listings = route.useLoaderData();
  return (
    <main>
      <h1 className="title">Integrations</h1>
      {listings.map((listing) => (
        <PortApps key={listing.port} {...listing} />
      ))}
    </main>
  );
}

function PortApps({ port, description, binding, candidates }: Listing) {
  const router = useRouter();
  const [change, setChange] = useState<Change | null>(null);
  const [failedApp, setFailedApp] = useState<string | null>(null);

  const run = async (next: Change, action: () => Promise<unknown>) => {
    if (change) return;
    setChange(next);
    setFailedApp(null);
    try {
      await action();
      await router.invalidate();
    } catch {
      setFailedApp(next.appId);
    } finally {
      setChange(null);
    }
  };

  // The switch moves when pressed, and moves back if the change fails.
  const boundAppId = change?.kind === "on" ? change.appId : change?.kind === "off" ? undefined : binding?.appId;

  return (
    <section>
      <h2 className="port">{description}</h2>
      {candidates.length === 0 && <p className="apps-empty">No app offers this yet.</p>}
      <ul className="apps">
        {candidates.map((app) => {
          const enabled = boundAppId === app.appId;
          // The platform reports credentials only for the bound app, so they appear after the reload.
          const credentials = enabled && binding?.appId === app.appId ? Object.entries(binding.credentials) : [];
          const named = credentials.length > 1;
          return (
            <li className="app" key={app.appId}>
              <div>
                <div className="app-name">{app.name}</div>
                {app.description && <p className="app-desc">{app.description}</p>}
                <div aria-live="polite">
                  {credentials.map(([name, { type, connected }]) => {
                    if (connected) {
                      return (
                        <p className="app-status" key={name}>
                          <b>{named ? `${name} connected` : "Connected"}</b>
                        </p>
                      );
                    }
                    if (type !== "oauth2") {
                      return (
                        <p className="app-status" key={name}>
                          <b>{named ? `${name} needs an API key` : "Needs an API key"}</b> from an admin.
                        </p>
                      );
                    }
                    // The button stays mounted while the provider URL loads, so it keeps focus if the request fails.
                    const opening = change?.kind === "connect" && change.credential === name;
                    return (
                      <div key={name}>
                        <p className="app-status">
                          <b>{named ? `${name} not connected.` : "Not connected."}</b> Registrations will not reach {app.name} until you
                          connect it.
                        </p>
                        <button
                          className="connect"
                          aria-disabled={opening}
                          onClick={() =>
                            run({ kind: "connect", appId: app.appId, credential: name }, async () =>
                              window.location.assign(await connect({ data: { port, credential: name, returnTo: window.location.href } })),
                            )
                          }
                        >
                          {opening ? `Opening ${app.name}…` : named ? `Connect ${name}` : "Connect"}
                        </button>
                      </div>
                    );
                  })}
                </div>
                {failedApp === app.appId && (
                  <p className="error" role="alert">
                    That did not work. Please try again.
                  </p>
                )}
              </div>
              <button
                className="switch"
                role="switch"
                aria-checked={enabled}
                aria-label={app.name}
                aria-busy={change?.appId === app.appId}
                onClick={() =>
                  run({ kind: enabled ? "off" : "on", appId: app.appId }, () =>
                    enabled ? disable({ data: { port } }) : enable({ data: { port, appId: app.appId } }),
                  )
                }
              />
            </li>
          );
        })}
      </ul>
      {candidates.length > 1 && <p className="apps-note">Only one app can do this at a time. Turning one on turns off the current one.</p>}
    </section>
  );
}
