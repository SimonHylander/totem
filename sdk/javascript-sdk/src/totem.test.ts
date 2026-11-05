import { ErrorCode } from "@totem/protocol";
import { Context, DateTime, Effect, Layer, Schema } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";
import { AppError, Totem, createHandler, fakePlatform } from "./index.js";

const Person = Schema.Struct({ email: Schema.String, firstName: Schema.optionalKey(Schema.String) });

const manifest = Totem.Manifest({
  name: "crm",
  version: "0.1.0",
  description: "Stores people.",
  provides: {
    actions: {
      save: {
        description: "Save a person.",
        input: Person,
        output: Schema.Struct({ id: Schema.String, at: Schema.DateTimeUtcFromString }),
      },
      count: { input: Totem.Empty, output: Schema.Struct({ count: Schema.Int }) },
    },
  },
  needs: {
    state: true,
    credentials: { crm: { type: "apiKey" } },
    actions: { enrich: { description: "Look up a person.", input: Person, output: Schema.Struct({ company: Schema.NullOr(Schema.String) }) } },
  },
  config: Schema.Struct({ pipeline: Schema.optionalKey(Schema.String) }),
});

class Ids extends Context.Service<Ids, { next: Effect.Effect<string> }>()("test/Ids") {}

const IdsLive = Layer.succeed(Ids, { next: Effect.succeed("id-1") });

const app = Totem.App(
  { manifest, layer: IdsLive },
  Effect.gen(function* () {
    const ids = yield* Ids;
    return {
      actions: {
        save: (person, ctx) =>
          Effect.gen(function* () {
            const { key } = yield* ctx.credentials.get("crm");
            const { company } = yield* ctx.ports.enrich(person);
            yield* ctx.state.update<number>("count", (count) => (count ?? 0) + 1);
            yield* ctx.log.info("saved", { key, company, pipeline: ctx.config.pipeline });
            return { id: yield* ids.next, at: DateTime.makeUnsafe("2026-01-01T00:00:00Z") };
          }),
        count: (_input, ctx) => ctx.state.get<number>("count").pipe(Effect.map((count) => ({ count: count ?? 0 }))),
      },
    };
  }),
);

const connected = () =>
  fakePlatform(app, {
    credentials: { crm: { type: "apiKey", key: "k" } },
    ports: { enrich: async () => ({ company: "Acme" }) },
  });

describe("Totem.Manifest", () => {
  it("emits plain JSON Schema with closed objects and fills the wire defaults", () => {
    expect(JSON.parse(JSON.stringify(manifest))).toMatchObject({
      name: "crm",
      protocol: "1",
      provides: {
        actions: {
          save: {
            description: "Save a person.",
            input: {
              type: "object",
              required: ["email"],
              properties: { email: { type: "string" }, firstName: { type: "string" } },
              additionalProperties: false,
            },
          },
          count: { input: { type: "object", additionalProperties: false } },
        },
      },
      needs: { state: true, credentials: { crm: { type: "apiKey" } } },
      config: { type: "object", additionalProperties: false },
    });
    expect(JSON.stringify(manifest)).not.toContain("~");
  });

  it("carries named schemas in $defs, so every $ref resolves", () => {
    const Named = Schema.Struct({ a: Schema.String }).annotate({ identifier: "Named" });
    const { provides } = Totem.Manifest({
      name: "refs",
      version: "0.1.0",
      provides: { actions: { run: { input: Schema.Struct({ x: Named }), output: Totem.Empty } } },
    });
    expect(provides.actions.run.input).toMatchObject({ properties: { x: { $ref: "#/$defs/Named" } }, $defs: { Named: { type: "object" } } });
  });

  it("refuses Schema.Struct({}), which accepts anything but null", () => {
    expect(() =>
      Totem.Manifest({ name: "open", version: "0.1.0", provides: { actions: { run: { input: Schema.Struct({}), output: Totem.Empty } } } }),
    ).toThrow("provides.actions.run.input accepts anything but null");
  });

  it("keeps each credential's type on the manifest", () => {
    const { needs } = Totem.Manifest({
      name: "oauth",
      version: "0.1.0",
      needs: {
        credentials: {
          crm: { type: "oauth2", authorizeUrl: "https://a.test/a", tokenUrl: "https://a.test/t", scopes: ["read"] },
          mail: { type: "apiKey" },
        },
      },
    });
    expect(needs.credentials.crm.type).toBe("oauth2");
    expectTypeOf(needs.credentials.mail.type).toEqualTypeOf<"apiKey">();
  });

  it("rejects authoring mistakes at compile time", () => {
    const valid = { input: Totem.Empty, output: Totem.Empty };
    const define = () => {
      // @ts-expect-error uppercase and spaces in the name
      Totem.Manifest({ name: "Not Valid", version: "0.1.0" });
      // @ts-expect-error not semver
      Totem.Manifest({ name: "ok", version: "banana" });
      // @ts-expect-error name is required
      Totem.Manifest({ version: "0.1.0" });
      // @ts-expect-error misspelled top-level key
      Totem.Manifest({ name: "ok", version: "0.1.0", descripton: "typo" });
      // @ts-expect-error misspelled key in needs
      Totem.Manifest({ name: "ok", version: "0.1.0", needs: { acions: {} } });
      // @ts-expect-error unknown key in an action
      Totem.Manifest({ name: "ok", version: "0.1.0", provides: { actions: { run: { ...valid, inputs: Totem.Empty } } } });
      // @ts-expect-error output is required
      Totem.Manifest({ name: "ok", version: "0.1.0", provides: { actions: { run: { input: Totem.Empty } } } });
      // @ts-expect-error input must be a schema, not raw JSON Schema
      Totem.Manifest({ name: "ok", version: "0.1.0", provides: { actions: { run: { input: { type: "object" }, output: Totem.Empty } } } });
      // @ts-expect-error action names are identifiers
      Totem.Manifest({ name: "ok", version: "0.1.0", provides: { actions: { "not-valid": valid } } });
      // @ts-expect-error unknown key in a credential
      Totem.Manifest({ name: "ok", version: "0.1.0", needs: { credentials: { crm: { type: "apiKey", scope: "x" } } } });
      // @ts-expect-error http on a non-localhost host
      Totem.Manifest({ name: "ok", version: "0.1.0", needs: { credentials: { crm: { type: "oauth2", authorizeUrl: "http://a.test/a", tokenUrl: "https://a.test/t", scopes: [] } } } });
    };
    expect(define).toBeTypeOf("function");
  });
});

describe("Totem.App", () => {
  it("runs a handler against the platform and the layer", async () => {
    const platform = connected();
    const output = await app.invoke("save", { email: "ada@acme.com" }, { platform, context: { config: { pipeline: "sales" } } });

    expect(output).toEqual({ id: "id-1", at: "2026-01-01T00:00:00.000Z" });
    expect(platform.portCalls).toEqual([{ port: "enrich", input: { email: "ada@acme.com" } }]);
    expect(await app.invoke("count", {}, { platform })).toEqual({ count: 1 });
    expect(platform.logs[0]).toEqual({ level: "info", message: "saved", data: { key: "k", company: "Acme", pipeline: "sales" } });
  });

  it("types handlers, the context and callers from the schemas", () => {
    Totem.App(
      { manifest },
      Effect.succeed({
        actions: {
          save: (person, ctx) => {
            expectTypeOf(person).toEqualTypeOf<{ readonly email: string; readonly firstName?: string }>();
            expectTypeOf(ctx.config.pipeline).toEqualTypeOf<string | undefined>();
            expectTypeOf(ctx.ports.enrich).parameter(0).toEqualTypeOf<{ readonly email: string; readonly firstName?: string }>();
            // @ts-expect-error undeclared credential
            ctx.credentials.get("nope");
            // @ts-expect-error undeclared port
            void ctx.ports.nope;
            return Effect.die("not run");
          },
          count: () => Effect.succeed({ count: 0 }),
        },
      }),
    );
    // @ts-expect-error a handler for every action is required
    Totem.App({ manifest }, Effect.succeed({ actions: { count: () => Effect.succeed({ count: 0 }) } }));
    // @ts-expect-error the wrong output type
    Totem.App({ manifest }, Effect.succeed({ actions: { save: () => Effect.succeed({ id: 1 }), count: () => Effect.succeed({ count: 0 }) } }));
    // @ts-expect-error `Ids` is not provided
    Totem.App({ manifest }, Effect.gen(function* () { yield* Ids; return { actions: { save: () => Effect.die(""), count: () => Effect.die("") } }; }));
    // @ts-expect-error caller input is checked
    void (() => app.invoke("save", { emial: "a" }, { platform: connected() }));
    expectTypeOf<ReturnType<typeof app.invoke<"count">>>().toEqualTypeOf<Promise<{ readonly count: number }>>();
  });

  it("gives ctx.state only to an app that declared it", () => {
    const stateless = Totem.Manifest({ name: "plain", version: "0.1.0", provides: { actions: { run: { input: Totem.Empty, output: Totem.Empty } } } });
    Totem.App(
      { manifest: stateless },
      Effect.succeed({
        actions: {
          run: (_input, ctx) => {
            // @ts-expect-error state is not declared
            void ctx.state;
            return Effect.succeed({});
          },
        },
      }),
    );
  });

  it("answers InvalidParams for input the schema rejects, including unknown keys", async () => {
    const platform = connected();
    await expect(app.invoke("save", { email: 1 } as never, { platform })).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    await expect(app.invoke("save", { email: "a", extra: true } as never, { platform })).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    await expect(app.invoke("count", "nope" as never, { platform })).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
  });

  it("rejects output the schema rejects", async () => {
    const leaky = Totem.App(
      { manifest },
      Effect.succeed({
        actions: {
          save: () => Effect.die("not run"),
          count: () => Effect.succeed({ count: 1, secret: "s" }),
        },
      }),
    );
    await expect(leaky.invoke("count", {}, { platform: connected() })).rejects.toMatchObject({ code: ErrorCode.InternalError });
  });

  it("surfaces platform failures and AppError unchanged", async () => {
    await expect(
      app.invoke("save", { email: "a" }, { platform: fakePlatform(app, { ports: { enrich: async () => ({ company: null }) } }) }),
    ).rejects.toMatchObject({ code: ErrorCode.CredentialMissing });

    const failing = Totem.App(
      { manifest },
      Effect.succeed({
        actions: {
          save: () => Effect.fail(new AppError(2001, "nope")),
          count: () => Effect.succeed({ count: 0 }),
        },
      }),
    );
    await expect(failing.invoke("save", { email: "a" }, { platform: connected() })).rejects.toMatchObject({ code: 2001, message: "nope" });
  });

  it("decodes a port's output and fails the call when the provider breaks its schema", async () => {
    const platform = fakePlatform(app, {
      credentials: { crm: { type: "apiKey", key: "k" } },
      ports: { enrich: (async () => ({ company: 5 })) as never },
    });
    await expect(app.invoke("save", { email: "a" }, { platform })).rejects.toMatchObject({ code: ErrorCode.InternalError });
  });

  it("builds once, keeps scoped resources open across calls and closes them on dispose", async () => {
    const events: string[] = [];
    const scoped = Layer.effect(
      Ids,
      Effect.acquireRelease(
        Effect.sync(() => {
          events.push("acquire");
          return { next: Effect.sync(() => (events.push("use"), "id")) };
        }),
        () => Effect.sync(() => void events.push("release")),
      ),
    );
    const resourceful = app.withLayer(scoped);
    const platform = connected();

    await resourceful.invoke("save", { email: "a" }, { platform });
    await resourceful.invoke("save", { email: "b" }, { platform });
    expect(events).toEqual(["acquire", "use", "use"]);

    await Effect.runPromise(resourceful.dispose);
    expect(events).toEqual(["acquire", "use", "use", "release"]);
  });

  it("retries the build after a failed layer", async () => {
    let attempts = 0;
    const flaky = Layer.effect(
      Ids,
      Effect.suspend(() => (++attempts === 1 ? Effect.fail(new Error("db down")) : Effect.succeed({ next: Effect.succeed("id") }))),
    );
    const resourceful = app.withLayer(flaky);
    const platform = connected();

    await expect(resourceful.invoke("count", {}, { platform })).rejects.toThrow("db down");
    expect(await resourceful.invoke("count", {}, { platform })).toEqual({ count: 0 });
    expect(attempts).toBe(2);
  });

  it("answers initialize and health without building the layer", async () => {
    let built = 0;
    const counted = Layer.effect(Ids, Effect.sync(() => (built++, { next: Effect.succeed("id") })));
    const handle = createHandler(app.withLayer(counted), { secret: "s" });
    const { sign, SIGNATURE_HEADER } = await import("@totem/protocol");
    const post = async (method: string, params: unknown) => {
      const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
      const response = await handle(new Request("http://app/", { method: "POST", body, headers: { [SIGNATURE_HEADER]: await sign("s", body) } }));
      return (await response.json()) as { result: { manifest?: { name: string } } };
    };

    const { result } = await post("initialize", { protocolVersion: "1", platformUrl: "http://platform/rpc" });
    await post("health", {});
    expect(result.manifest?.name).toBe("crm");
    expect(built).toBe(0);
  });

  it("runs handlers inside the call's span", async () => {
    let parent: string | undefined;
    const traced = Totem.App(
      { manifest },
      Effect.succeed({
        actions: {
          save: () => Effect.die("not run"),
          count: () =>
            Effect.gen(function* () {
              parent = (yield* Effect.orDie(Effect.currentSpan)).name;
              return { count: 0 };
            }),
        },
      }),
    );
    await traced.invoke("count", {}, { platform: connected() });
    expect(parent).toBe("action count");
  });
});
