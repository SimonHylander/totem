import { createFileRoute } from "@tanstack/react-router";
import { totem } from "../totem/connection.js";

// The Totem endpoint. The platform registers the app at this URL and sends signed JSON-RPC here.
export const Route = createFileRoute("/totem")({
  server: { handlers: { POST: ({ request }) => totem().handle(request) } },
});
