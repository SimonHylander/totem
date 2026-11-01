import { useState } from "react";
import { Link, getRouteApi, useRouter } from "@tanstack/react-router";
import { connect, disable, enable, type Port } from "./server.js";

const route = getRouteApi("/integrations");

export function IntegrationsPage() {
  const ports = route.useLoaderData();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

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
