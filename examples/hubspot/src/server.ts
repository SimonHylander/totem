import { serve } from "@totem/sdk";
import { app } from "./app.js";

const secret = process.env["TOTEM_APP_SECRET"];
if (!secret) throw new Error("TOTEM_APP_SECRET is required");

const port = Number(process.env["PORT"] ?? 3002);
await serve(app, { secret, port, platformUrl: process.env["TOTEM_PLATFORM_URL"] });
console.log(`hubspot app listening on :${port}`);
