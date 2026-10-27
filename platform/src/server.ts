import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { Otlp } from "effect/observability";
import type { Principal } from "./access.js";
import { createPlatform } from "./http.js";
import { listen } from "./node.js";

// Development server. Reads platform/.env.local (see package.json `dev`).
//   TOTEM_BASE_URL               public origin, default http://localhost:3000
//   TOTEM_PRINCIPALS             JSON array of { token, principal: { id, role } }
//   OTEL_EXPORTER_OTLP_ENDPOINT  optional OTLP/HTTP collector, such as http://localhost:4318. Logs
//                                still go to the console as well.

const baseUrl = process.env["TOTEM_BASE_URL"] ?? "http://localhost:3000";
const principals = JSON.parse(process.env["TOTEM_PRINCIPALS"] ?? "[]") as { token: string; principal: Principal }[];
if (principals.length === 0) throw new Error("TOTEM_PRINCIPALS is required");

const collector = process.env["OTEL_EXPORTER_OTLP_ENDPOINT"];
const telemetry = collector
  ? Otlp.layerJson({ baseUrl: collector, resource: { serviceName: "totem-platform" }, loggerMergeWithExisting: true }).pipe(
      Layer.provide(FetchHttpClient.layer),
    )
  : Layer.empty;

const { handle, runtime } = createPlatform({ baseUrl, principals, allowLocalhost: true }, telemetry);
await listen(handle, baseUrl);
console.log(`totem platform on ${baseUrl}`);

// Disposing the runtime flushes buffered spans and logs.
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => void runtime.dispose().then(() => process.exit(0)));
