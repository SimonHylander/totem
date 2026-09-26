import { serve } from "@ipaas/sdk";
import { app } from "./app.js";

const secret = process.env["IPAAS_APP_SECRET"];
if (!secret) throw new Error("IPAAS_APP_SECRET is required");

const port = Number(process.env["PORT"] ?? 3001);
await serve(app, { secret, port, platformUrl: process.env["IPAAS_PLATFORM_URL"] });
console.log(`contacts app listening on :${port}`);
