import { createFileRoute } from "@tanstack/react-router";
import { RegistrationError, RegistrationPage } from "../features/registration/RegistrationPage.js";
import { getEvent } from "../features/registration/server.js";

export const Route = createFileRoute("/events/$eventId")({
  loader: ({ params }) => getEvent({ data: params.eventId }),
  head: ({ loaderData }) => ({ meta: [{ title: loaderData ? loaderData.name : "Event" }] }),
  errorComponent: RegistrationError,
  component: RegistrationPage,
});
