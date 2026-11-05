import { createServerFn } from "@tanstack/react-start";
import { connectOnce, eventsInstall } from "../../totem/connection.js";

export const listEvents = createServerFn({ method: "GET" }).handler(() => connectOnce().client.start(eventsInstall(), "listEvents", {}));
