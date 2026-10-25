import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: () => (
    <p>
      Open an event's registration page at <code>/events/&lt;install id&gt;</code>. Each install of this app is one
      event.
    </p>
  ),
});
