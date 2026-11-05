import { createFileRoute } from "@tanstack/react-router";
import { IntegrationsPage } from "../features/integrations/IntegrationsPage.js";
import { getIntegrations } from "../features/integrations/server.js";

export const Route = createFileRoute("/integrations")({
  loader: () => getIntegrations(),
  errorComponent: () => <p>Integrations could not be loaded. Reload the page to try again.</p>,
  component: IntegrationsPage,
});
