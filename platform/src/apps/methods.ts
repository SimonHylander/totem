import { Effect } from "effect";
import type { SignedMethods } from "../http/route.js";
import { listApps } from "./operations.js";

export const signedMethods = {
  "apps/list": (_params, { auth: install }) => Effect.map(listApps(install), (apps) => ({ apps })),
} satisfies SignedMethods;
