import { createServer, type Server } from "node:http";
import { text } from "node:stream/consumers";

/** Serve a fetch-style handler on a Node HTTP server. Resolves once listening. */
export function listen(handle: (request: Request) => Promise<Response>, baseUrl: string): Promise<Server> {
  const server = createServer(async (req, res) => {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(name, value);
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const response = await handle(
      new Request(new URL(req.url ?? "/", baseUrl), { method: req.method, headers, ...(hasBody && { body: await text(req) }) }),
    );
    res.statusCode = response.status;
    response.headers.forEach((value, name) => res.setHeader(name, value));
    res.end(await response.text());
  });
  return new Promise((resolve) => server.listen(Number(new URL(baseUrl).port || 80), () => resolve(server)));
}
