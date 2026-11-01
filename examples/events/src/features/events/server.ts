import { createServerFn } from "@tanstack/react-start";
import { eventsInstall, totem } from "../../totem/connection.js";

export const listEvents = createServerFn({ method: "GET" }).handler(() => totem().client.start(eventsInstall(), "listEvents", {}));
