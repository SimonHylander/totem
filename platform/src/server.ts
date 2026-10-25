import { createServer } from "node:http";
import { text } from "node:stream/consumers";
import type { Principal } from "./access.js";
import { createPlatform } from "./http.js";

// Development server. Reads platform/.env.local (see package.json `dev`).
//   TOTEM_BASE_URL   public origin, default http://localhost:3000
//   TOTEM_PRINCIPALS JSON array of { token, principal: { id, role } }

const baseUrl = process.env["TOTEM_BASE_URL"] ?? "http://localhost:3000";
const principals = JSON.parse(process.env["TOTEM_PRINCIPALS"] ?? "[]") as { token: string; principal: Principal }[];
if (principals.length === 0) throw new Error("TOTEM_PRINCIPALS is required");

const { handle } = createPlatform({ baseUrl, principals, allowLocalhost: true });

createServer(async (req, res) => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(name, value);
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const response = await handle(
    new Request(new URL(req.url ?? "/", baseUrl), { method: req.method, headers, ...(hasBody && { body: await text(req) }) }),
  );
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.end(await response.text());
}).listen(new URL(baseUrl).port || 80, () => console.log(`totem platform on ${baseUrl}`));
