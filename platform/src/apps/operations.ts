import { AppId, VersionId } from "@totem/ids";
import { PROTOCOL_VERSION, type CatalogApp, type Manifest } from "@totem/protocol";
import { sameJson, type AppVersion } from "@totem/versions";
import { DateTime, Effect } from "effect";
import type { Authorized } from "@totem/permissions";
import { callApp } from "../app-calls/app-calls.js";
import { PlatformConfig } from "../config.js";
import { InvalidManifest } from "../errors.js";
import { PLATFORM_METHODS_PATH } from "../http/paths.js";
import type { Install } from "../installs/installs.js";
import { Sealed, randomToken } from "../secrets.js";
import { Apps, type AppRecord, type Visibility } from "./apps.js";

// App registration, manifest pull and visibility, and the catalog of public apps.

/**
 * Register an app URL and issue its HMAC secret, shown once. The operator starts the app with the
 * secret, then calls `initializeApp` to pull the manifest.
 */
export const registerApp = Effect.fnUntraced(function* (_: Authorized<{ type: "app.register" }>, url: string) {
  const secret = randomToken();
  const app: AppRecord = {
    id: AppId.make(crypto.randomUUID()),
    url,
    secret: new Sealed(secret),
    latest: null,
    visibility: "internal",
  };
  yield* (yield* Apps).put(app);
  return { appId: app.id, secret };
});

/**
 * Pull the manifest through `initialize` (ADR 0007). A manifest that differs from the latest version
 * becomes a new version. Existing installs keep theirs until they upgrade (ADR 0017).
 */
export const initializeApp = Effect.fnUntraced(function* (_: Authorized<{ type: "app.register" }>, appId: AppId) {
  const apps = yield* Apps;
  const platformUrl = (yield* PlatformConfig).baseUrl + PLATFORM_METHODS_PATH;
  const { manifest } = yield* callApp(yield* apps.get(appId), "initialize", "initialize", {}, () => ({
    protocolVersion: PROTOCOL_VERSION,
    platformUrl,
  })).pipe(Effect.catchTag("SchemaError", (error) => Effect.fail(new InvalidManifest({ message: error.message }))));
  yield* checkEndpoints(manifest);
  const version: AppVersion = { id: VersionId.make(crypto.randomUUID()), appId, manifest, pulledAt: yield* DateTime.now };
  yield* apps.update(appId, (app) => (app.latest && sameJson(app.latest.manifest, manifest) ? app : { ...app, latest: version }));
  return manifest;
});

/** Make an app public or internal (ADR 0015). New apps start internal. */
export const setVisibility = Effect.fnUntraced(function* (
  _: Authorized<{ type: "app.setVisibility" }>,
  appId: AppId,
  visibility: Visibility,
) {
  yield* (yield* Apps).update(appId, (app) => ({ ...app, visibility }));
});

/** `apps/list`: every initialized public app other than the caller. */
export const listApps = (caller: Install) =>
  Apps.use((apps) =>
    Effect.map(apps.all, (all) =>
      all.flatMap((app): CatalogApp[] => {
        const manifest = app.latest?.manifest;
        return app.visibility === "public" && manifest && app.id !== caller.appId
          ? [
              {
                appId: app.id,
                name: manifest.name,
                ...(manifest.description !== undefined && { description: manifest.description }),
                actions: manifest.provides.actions ?? {},
              },
            ]
          : [];
      }),
    ),
  );

/**
 * Provider endpoints receive client secrets and refresh tokens, so check the parsed URL rather
 * than trusting the schema pattern alone (ADR 0012).
 */
const checkEndpoints = Effect.fnUntraced(function* (manifest: Manifest) {
  const { allowLocalhost } = yield* PlatformConfig;
  for (const [name, need] of Object.entries(manifest.needs.credentials ?? {})) {
    if (need.type !== "oauth2") continue;
    for (const endpoint of [need.authorizeUrl, need.tokenUrl]) {
      const url = URL.parse(endpoint);
      const ok =
        url !== null &&
        url.username === "" &&
        url.password === "" &&
        (url.protocol === "https:" || (allowLocalhost && url.protocol === "http:" && url.hostname === "localhost"));
      if (!ok) return yield* new InvalidManifest({ message: `credential ${name}: endpoint ${endpoint} must be https` });
    }
  }
});
