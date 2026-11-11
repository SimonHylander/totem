import { AppId } from "@totem/ids";
import { requireActive } from "@totem/installs";
import { CallDepth, forward, invoke } from "@totem/runtime";
import { Effect, Schema } from "effect";
import type { CallbackClaims } from "../app-calls/callback-token.js";
import { BadRequest, NotDeclared } from "../errors.js";
import type { CallbackMethods, SignedMethods } from "../http/route.js";
import { Installs } from "./installs.js";
import { bindPort, connectPort, listPorts, unbindPort } from "./operations.js";

export const methods = {
  "state/get": ({ key }, { auth: claims }) =>
    Effect.map(statefulInstall(claims), (install) => {
      const entry = install.state.get(key);
      return { value: entry?.value ?? null, version: entry?.version ?? 0 };
    }),

  "state/set": Effect.fnUntraced(function* ({ key, value, version }, { auth: claims }) {
    yield* statefulInstall(claims);
    return { version: yield* (yield* Installs).setState(claims.installId, key, value, version) };
  }),

  "actions/invoke": Effect.fnUntraced(function* ({ port, input }, { auth: claims }) {
    const caller = yield* (yield* Installs).get(claims.installId);
    return { output: yield* forward(caller, port, input, claims.depth) };
  }),
} satisfies CallbackMethods;

export const signedMethods = {
  "actions/start": Effect.fnUntraced(function* ({ action, input }, { auth: install }) {
    const active = yield* Effect.fromResult(requireActive(install));
    return { output: yield* invoke(active, action, input, CallDepth.make(0)) };
  }),

  "ports/list": (_params, { auth: install }) => Effect.map(listPorts(install), (ports) => ({ ports })),

  "ports/bind": Effect.fnUntraced(function* ({ port, appId, action }, { auth: install }) {
    const provider = yield* Schema.decodeEffect(AppId)(appId).pipe(
      Effect.mapError(() => new BadRequest({ message: "appId is required" })),
    );
    yield* bindPort(install, port, provider, action);
    return {};
  }),

  "ports/unbind": Effect.fnUntraced(function* ({ port }, { auth: install }) {
    yield* unbindPort(install, port);
    return {};
  }),

  "ports/connect": Effect.fnUntraced(function* ({ port, credential, returnTo }, { auth: install }) {
    return { url: yield* connectPort(install, port, credential, returnTo) };
  }),
} satisfies SignedMethods;

const statefulInstall = Effect.fnUntraced(function* (claims: CallbackClaims) {
  const install = yield* (yield* Installs).get(claims.installId);
  if (install.version.manifest.needs.state !== true) {
    return yield* new NotDeclared({ message: "state is not declared in the manifest" });
  }
  return install;
});
