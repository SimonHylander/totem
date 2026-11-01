import { InstallRepo, declaresPort, providesAction, requireActive, type ActiveInstall, type InstallCore } from "@totem/installs";
import { Effect, Result } from "effect";
import { CallDepthExceeded, PortUnbound } from "./errors.js";
import { CallDepth, MAX_CALL_DEPTH } from "./model.js";
import { AppTransport } from "./port.js";

/** The depth of a port call made at `depth`, or CallDepthExceeded at the limit. */
export const deeper = (depth: CallDepth): Result.Result<CallDepth, CallDepthExceeded> =>
  depth < MAX_CALL_DEPTH
    ? Result.succeed(CallDepth.make(depth + 1))
    : Result.fail(new CallDepthExceeded({ message: `port calls nested deeper than ${String(MAX_CALL_DEPTH)}` }));

/**
 * Run `action` on an active install at `depth`. The app's endpoint serves its newest code, so an
 * action the install's pinned version does not provide is refused here (ADR 0017).
 */
export const invoke = Effect.fnUntraced(function* (install: ActiveInstall, action: string, input: unknown, depth: CallDepth) {
  yield* Effect.fromResult(providesAction(install.version.manifest, action, `install ${install.id}`));
  return yield* AppTransport.use((transport) => transport.invoke(install, action, input, depth));
});

/**
 * A port call from `caller`'s app at `depth`: run the action the port is bound to on the provider
 * install, and return the provider's output or error unchanged (ADR 0013).
 */
export const forward = Effect.fnUntraced(function* (caller: InstallCore, port: string, input: unknown, depth: CallDepth) {
  yield* Effect.fromResult(declaresPort(caller.version.manifest, port));
  const binding = caller.bindings.get(port);
  const provider = binding && (yield* InstallRepo.use((repo) => repo.lookup(binding.installId)));
  if (!binding || provider?.tenantId !== caller.tenantId) {
    return yield* new PortUnbound({ message: `port "${port}" has no provider bound` });
  }
  const next = yield* Effect.fromResult(deeper(depth));
  const active = yield* Effect.fromResult(requireActive(provider));
  return yield* invoke(active, binding.action, input, next);
});
