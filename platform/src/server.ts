import type { Principal } from "./access.js";
import { createPlatform } from "./http.js";
import { listen } from "./node.js";

// Development server. Reads platform/.env.local (see package.json `dev`).
//   TOTEM_BASE_URL   public origin, default http://localhost:3000
//   TOTEM_PRINCIPALS JSON array of { token, principal: { id, role } }

const baseUrl = process.env["TOTEM_BASE_URL"] ?? "http://localhost:3000";
const principals = JSON.parse(process.env["TOTEM_PRINCIPALS"] ?? "[]") as { token: string; principal: Principal }[];
if (principals.length === 0) throw new Error("TOTEM_PRINCIPALS is required");

const { handle } = createPlatform({ baseUrl, principals, allowLocalhost: true });
await listen(handle, baseUrl);
console.log(`totem platform on ${baseUrl}`);
