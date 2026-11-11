import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { Unauthorized, endpoint, type MethodHandlers } from "./endpoint.js";
import { RpcError } from "./jsonrpc.js";
import { ErrorCode } from "./types.js";

const schemas = {
  echo: { params: Schema.Struct({ text: Schema.String }), result: Schema.Struct({ text: Schema.String, user: Schema.String }) },
  fail: { params: Schema.Struct({}), result: Schema.Never },
  crash: { params: Schema.Struct({}), result: Schema.Never },
};

const methods: MethodHandlers<typeof schemas, string, RpcError, never> = {
  echo: ({ text }, { auth }) => Effect.succeed({ text, user: auth }),
  fail: () => Effect.fail(new RpcError(1001, "nope", { why: "test" })),
  crash: () => Effect.die(new Error("boom")),
};

const token = (request: Request) =>
  request.headers.get("authorization") === "Bearer ok" ? Effect.succeed("ada") : Effect.fail(new Unauthorized({ message: "bad token" }));

const beforeParse = endpoint({ schemas, methods, authenticate: { beforeParse: token }, onDefect: () => Effect.void });
const afterLookup = endpoint({ schemas, methods, authenticate: { afterLookup: token } });

async function send(handle: typeof beforeParse, body: string, auth = "Bearer ok") {
  const response = await Effect.runPromise(
    handle(new Request("http://test/rpc", { method: "POST", headers: { authorization: auth }, body })),
  );
  return { status: response.status, body: await response.json() };
}

const call = (method: string, params: unknown = {}) => JSON.stringify({ jsonrpc: "2.0", id: 7, method, params });

describe("endpoint", () => {
  it("answers the handler's result", async () => {
    expect(await send(beforeParse, call("echo", { text: "hi" }))).toEqual({
      status: 200,
      body: { jsonrpc: "2.0", id: 7, result: { text: "hi", user: "ada" } },
    });
  });

  it("answers bad JSON and a non JSON-RPC body with a null id", async () => {
    expect(await send(beforeParse, "{")).toEqual({
      status: 200,
      body: { jsonrpc: "2.0", id: null, error: { code: ErrorCode.ParseError, message: "invalid JSON" } },
    });
    expect(await send(beforeParse, JSON.stringify({ id: 7, method: "echo" }))).toEqual({
      status: 200,
      body: { jsonrpc: "2.0", id: null, error: { code: ErrorCode.InvalidRequest, message: "not a JSON-RPC 2.0 request" } },
    });
  });

  it("answers an unknown method, including inherited names", async () => {
    for (const method of ["nope", "toString"]) {
      expect((await send(beforeParse, call(method))).body).toEqual({
        jsonrpc: "2.0",
        id: 7,
        error: { code: ErrorCode.MethodNotFound, message: `unknown method "${method}"` },
      });
    }
  });

  it("answers an RpcError with its envelope and a defect with InternalError", async () => {
    expect((await send(beforeParse, call("fail"))).body).toEqual({
      jsonrpc: "2.0",
      id: 7,
      error: { code: 1001, message: "nope", data: { why: "test" } },
    });
    expect((await send(beforeParse, call("crash"))).body).toEqual({
      jsonrpc: "2.0",
      id: 7,
      error: { code: ErrorCode.InternalError, message: "internal error" },
    });
  });

  it("answers a failed authentication with 401, before parsing or after lookup", async () => {
    const unauthorized = { code: ErrorCode.Unauthorized, message: "bad token" };
    expect(await send(beforeParse, "{", "Bearer no")).toEqual({
      status: 401,
      body: { jsonrpc: "2.0", id: null, error: unauthorized },
    });
    expect(await send(afterLookup, call("echo", { text: "hi" }), "Bearer no")).toEqual({
      status: 401,
      body: { jsonrpc: "2.0", id: 7, error: unauthorized },
    });
  });

  it("answers an unknown method and bad params before authenticating after lookup", async () => {
    expect((await send(afterLookup, call("nope"), "Bearer no")).status).toBe(200);
    expect(await send(afterLookup, call("echo", { text: 1 }), "Bearer no")).toMatchObject({
      status: 200,
      body: { id: 7, error: { code: ErrorCode.InvalidParams } },
    });
  });
});
