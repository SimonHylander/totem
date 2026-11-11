import { AppId } from "@totem/ids";
import { Effect, Schema } from "effect";
import { allowed } from "../access/access.js";
import { NoParams, NonEmpty, route } from "../http/route.js";
import { initializeApp, registerApp, setVisibility } from "./operations.js";

export const routes = [
  route("POST", "/api/apps", NoParams, Schema.Struct({ url: NonEmpty }), (principal, _, { url }) =>
    Effect.flatMap(allowed(principal, { type: "app.register" }), (auth) => registerApp(auth, url)),
  ),
  route("POST", "/api/apps/:appId/initialize", Schema.Struct({ appId: AppId }), Schema.Unknown, (principal, { appId }) =>
    allowed(principal, { type: "app.register" }).pipe(
      Effect.flatMap((auth) => initializeApp(auth, appId)),
      Effect.map((manifest) => ({ manifest })),
    ),
  ),
  route(
    "PUT",
    "/api/apps/:appId/visibility",
    Schema.Struct({ appId: AppId }),
    Schema.Struct({ visibility: Schema.Literals(["public", "internal"]) }),
    (principal, { appId }, { visibility }) =>
      allowed(principal, { type: "app.setVisibility" }).pipe(
        Effect.flatMap((auth) => setVisibility(auth, appId, visibility)),
        Effect.as({}),
      ),
  ),
];
