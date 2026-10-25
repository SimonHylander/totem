import {
  SIGNATURE_HEADER,
  rpc,
  sign,
  type BoundPort,
  type CatalogApp,
  type Manifest,
  type SignedPlatformMethods,
} from "@totem/protocol";
import type { App } from "./define-app.js";
import type { ActionInput, ActionName, ActionOutput, PortName } from "./types.js";

type AppClientOptions = {
  /** The HMAC secret issued at registration, the same one `createHandler` verifies with. */
  secret: string;
  platformUrl: string;
  fetch?: typeof fetch;
};

/**
 * Call the platform from code the platform did not call, such as a UI's server. Every request is
 * signed with the app's HMAC secret and names one of its installs. `start` runs the app's own
 * actions (ADR 0014). The other methods read the catalog and bind, unbind and connect the app's
 * ports (ADR 0015). The app is passed only to type actions and ports from its manifest.
 */
export function appClient<M extends Manifest>(_app: App<M>, { secret, platformUrl, fetch: doFetch }: AppClientOptions) {
  const call = <K extends keyof SignedPlatformMethods>(method: K, params: SignedPlatformMethods[K]["params"]) =>
    rpc<SignedPlatformMethods, K>(platformUrl, method, params, {
      sign: async (body) => ({ [SIGNATURE_HEADER]: await sign(secret, body) }),
      ...(doFetch && { fetch: doFetch }),
    });

  return {
    async start<K extends ActionName<M>>(installId: string, action: K, input: ActionInput<M, K>): Promise<ActionOutput<M, K>> {
      const { output } = await call("actions/start", { installId, action, input });
      // The platform returns what this app's own action returned, so the manifest's output type holds.
      return output as ActionOutput<M, K>;
    },

    /** Every public app other than this one, with the actions it provides. */
    async apps(installId: string): Promise<CatalogApp[]> {
      return (await call("apps/list", { installId })).apps;
    },

    /** Each port in `needs.actions` with its provider, or null when unbound. */
    async ports(installId: string): Promise<Record<PortName<M>, BoundPort | null>> {
      // The platform answers with exactly the manifest's ports.
      return (await call("ports/list", { installId })).ports as Record<PortName<M>, BoundPort | null>;
    },

    /** Bind a port to a public app's action. The platform installs that app for the tenant if needed. */
    async bind(installId: string, port: PortName<M>, provider: { appId: string; action: string }): Promise<void> {
      await call("ports/bind", { installId, port, ...provider });
    },

    async unbind(installId: string, port: PortName<M>): Promise<void> {
      await call("ports/unbind", { installId, port });
    },

    /**
     * Start an OAuth connect for a credential of the app bound to `port`. Send the browser to the
     * returned URL. The platform redirects it to `returnTo`, on this app's origin, when done.
     */
    async connect(installId: string, port: PortName<M>, credential: string, returnTo: string): Promise<string> {
      return (await call("ports/connect", { installId, port, credential, returnTo })).url;
    },
  };
}
