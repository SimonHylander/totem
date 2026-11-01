import { createServerFn } from "@tanstack/react-start";
import { eventsInstall, totem } from "../../totem/connection.js";

/** Every event of the tenant install this deployment serves. */
export const listEvents = createServerFn({ method: "GET" }).handler(() => totem().client.start(eventsInstall(), "listEvents", {}));
