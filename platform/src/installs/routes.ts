import { AppId, InstallId, TenantId } from "@totem/ids";
import { Effect, Schema } from "effect";
import { allowed, authorizeInstall } from "../access/access.js";
import { NonEmpty, route } from "../http/route.js";
import { createInstall, invokeAction, setBinding, upgradeInstall } from "./operations.js";

const PortBinding = Schema.Struct({ installId: InstallId, action: NonEmpty });
const JsonObject = Schema.Record(Schema.String, Schema.Unknown);

export const routes = [
  route(
    "POST",
    "/api/tenants/:tenantId/installs",
    Schema.Struct({ tenantId: TenantId }),
    Schema.Struct({
      appId: AppId,
      config: Schema.optionalKey(JsonObject),
      bindings: Schema.optionalKey(Schema.Record(Schema.String, PortBinding)),
    }),
    (principal, { tenantId }, { appId, config = {}, bindings = {} }) =>
      allowed(principal, { type: "install.create", tenantId }).pipe(
        Effect.flatMap((auth) => createInstall(auth, appId, config, bindings)),
        Effect.map((install) => ({ installId: install.id })),
      ),
  ),
  route(
    "PUT",
    "/api/installs/:installId/bindings/:port",
    Schema.Struct({ installId: InstallId, port: NonEmpty }),
    PortBinding,
    (principal, { installId, port }, binding) =>
      authorizeInstall(principal, installId, "install.bind").pipe(
        Effect.flatMap((auth) => setBinding(auth, port, binding)),
        Effect.as({}),
      ),
  ),
  route(
    "POST",
    "/api/installs/:installId/upgrade",
    Schema.Struct({ installId: InstallId }),
    Schema.Unknown,
    (principal, { installId }) =>
      authorizeInstall(principal, installId, "install.upgrade").pipe(
        Effect.flatMap(upgradeInstall),
        Effect.map((version) => ({ versionId: version.id, version: version.manifest.version })),
      ),
  ),
  route(
    "POST",
    "/api/installs/:installId/actions/:action",
    Schema.Struct({ installId: InstallId, action: NonEmpty }),
    Schema.Struct({ input: Schema.optionalKey(Schema.Unknown) }),
    (principal, { installId, action }, { input = {} }) =>
      authorizeInstall(principal, installId, "install.invoke").pipe(
        Effect.flatMap((auth) => invokeAction(auth, action, input)),
        Effect.map((output) => ({ output })),
      ),
  ),
];
