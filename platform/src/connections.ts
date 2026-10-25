import { ErrorCode, RpcError, type CredentialValue } from "@totem/protocol";
import { HttpError, authorize, type Principal } from "./access.js";
import { getInstall, manifestOf } from "./apps.js";
import type { CallbackClaims } from "./callback-token.js";
import { Sealed, type Context, type Install } from "./store.js";

// Connector credentials: what tenants connect, and what `credentials/get` hands to apps (ADR 0009).

/** Store the API key a tenant admin entered. Idempotent. */
export function connectApiKey(ctx: Context, principal: Principal, installId: string, name: string, key: string): void {
  const install = getInstall(ctx, installId);
  authorize(principal, { type: "install.connect", install });
  if (manifestOf(ctx, install).needs.credentials?.[name]?.type !== "apiKey") {
    throw new HttpError(404, `no apiKey credential ${name}`);
  }
  install.connections.set(name, { type: "apiKey", key: new Sealed(key) });
}

/** `credentials/get`. The callback token picks the install. */
export async function getCredential(ctx: Context, claims: CallbackClaims, name: string): Promise<CredentialValue> {
  const install: Install = getInstall(ctx, claims.installId);
  const need = manifestOf(ctx, install).needs.credentials?.[name];
  if (!need) throw new RpcError(ErrorCode.NotDeclared, `credential "${name}" is not declared in the manifest`);

  const connection = install.connections.get(name);
  if (connection?.type !== need.type) {
    throw new RpcError(ErrorCode.CredentialMissing, `credential "${name}" is not connected`);
  }
  return { type: "apiKey", key: connection.key.reveal() };
}
