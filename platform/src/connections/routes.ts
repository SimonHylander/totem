import { AppId, InstallId } from "@totem/ids";
import { Effect, Schema } from "effect";
import { allowed, authorizeInstall } from "../access/access.js";
import { NonEmpty, route } from "../http/route.js";
import { Connections } from "./connections.js";

export const routes = [
  route(
    "PUT",
    "/api/apps/:appId/oauth-clients/:name",
    Schema.Struct({ appId: AppId, name: NonEmpty }),
    Schema.Struct({ clientId: NonEmpty, clientSecret: NonEmpty }),
    (principal, { appId, name }, client) =>
      Effect.flatMap(allowed(principal, { type: "app.setOAuthClient" }), (auth) =>
        Connections.use((connections) => connections.setOAuthClient(auth, appId, name, client)),
      ),
  ),
  route(
    "PUT",
    "/api/installs/:installId/connections/:name/api-key",
    Schema.Struct({ installId: InstallId, name: NonEmpty }),
    Schema.Struct({ key: NonEmpty }),
    (principal, { installId, name }, { key }) =>
      authorizeInstall(principal, installId, "install.connect").pipe(
        Effect.flatMap((auth) => Connections.use((connections) => connections.connectApiKey(auth, name, key))),
        Effect.as({}),
      ),
  ),
];
