import { SIGNATURE_HEADER, rpc, sign, type Manifest, type SignedPlatformMethods } from "@totem/protocol";
import type { App } from "./define-app.js";
import type { ActionInput, ActionName, ActionOutput } from "./types.js";

type AppClientOptions = {
  /** The HMAC secret issued at registration, the same one `createHandler` verifies with. */
  secret: string;
  platformUrl: string;
  fetch?: typeof fetch;
};

/**
 * Start this app's own actions through the platform (ADR 0014), from code the platform did not
 * call, such as a UI's server. The platform runs the action with the install's full context. The
 * app is passed only to type `start` from its manifest.
 */
export function appClient<M extends Manifest>(_app: App<M>, { secret, platformUrl, fetch: doFetch }: AppClientOptions) {
  return {
    async start<K extends ActionName<M>>(installId: string, action: K, input: ActionInput<M, K>): Promise<ActionOutput<M, K>> {
      const { output } = await rpc<SignedPlatformMethods, "actions/start">(
        platformUrl,
        "actions/start",
        { installId, action, input },
        {
          sign: async (body) => ({ [SIGNATURE_HEADER]: await sign(secret, body) }),
          ...(doFetch && { fetch: doFetch }),
        },
      );
      // The platform returns what this app's own action returned, so the manifest's output type holds.
      return output as ActionOutput<M, K>;
    },
  };
}
