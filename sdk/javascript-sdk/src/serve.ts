import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { text } from "node:stream/consumers";
import type { Manifest } from "@totem/protocol";
import type { App } from "./define-app.js";
import { createHandler } from "./handler.js";

type ServeOptions = Parameters<typeof createHandler>[1] & {
  port: number;
};

/** Node adapter around `createHandler`. Resolves once listening. */
export function serve<M extends Manifest>(app: App<M>, { port, ...handlerOptions }: ServeOptions): Promise<Server> {
  const handle = createHandler(app, handlerOptions);

  const server = createServer(async (req, res) => {
    const response = await handle(await toRequest(req));
    await writeResponse(res, response);
  });

  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

async function toRequest(req: IncomingMessage): Promise<Request> {
  const url = `http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(name, value);
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(url, { method: req.method, headers, ...(hasBody && { body: await text(req) }) });
}

async function writeResponse(res: ServerResponse, response: Response) {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.end(await response.text());
}
