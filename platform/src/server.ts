import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { Otlp } from "effect/observability";
import { createPlatform, type PlatformOptions } from "./http.js";
import { listen } from "./node.js";

const baseUrl = process.env["TOTEM_BASE_URL"] ?? "http://localhost:3000";
const principals = JSON.parse(process.env["TOTEM_PRINCIPALS"] ?? "[]") as PlatformOptions["principals"];
if (principals.length === 0) throw new Error("TOTEM_PRINCIPALS is required: a JSON array of { token, principal: { id, role } }");

const collector = process.env["OTEL_EXPORTER_OTLP_ENDPOINT"];
const telemetry = collector
  ? Otlp.layerJson({ baseUrl: collector, resource: { serviceName: "totem-platform" }, loggerMergeWithExisting: true }).pipe(
      Layer.provide(FetchHttpClient.layer),
    )
  : Layer.empty;

const { handle, runtime } = createPlatform({ baseUrl, principals, allowLocalhost: true }, telemetry);
await listen(handle, baseUrl);
console.log(`totem platform on ${baseUrl}`);

const flushTelemetryAndExit = () => void runtime.dispose().then(() => process.exit(0));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, flushTelemetryAndExit);
