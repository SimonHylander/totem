import type { CallbackMethods } from "../http/route.js";
import { Connections } from "./connections.js";

export const methods = {
  "credentials/get": ({ name }, { auth: claims }) => Connections.use((connections) => connections.get(claims.installId, name)),
} satisfies CallbackMethods;
