---
name: verify-totem
description: Prove a change to the platform, SDK, protocol or a domain package works end to end, by running the real platform and two apps over HTTP. Use before calling such a change done.
---

# Verify Totem

`pnpm verify` proves the code compiles, follows the rules and passes its unit tests. This run proves the feature works: a real platform and two real apps talk over HTTP, the way an operator, a tenant and a third-party app would.

## Run

```sh
pnpm verify:live
```

It builds `@totem/example-contacts` and its dependencies, then runs `examples/contacts/src/live.ts`. The run uses ports 3100 to 3102 and prints one `verify-totem:` line per step. It is green when it prints `verify-totem: ok` and exits 0.

## What it covers

1. Register and initialize the contacts app and an inline enricher app.
2. Install the enricher, then install contacts with config and its `enrichPerson` port bound to the enricher.
3. Connect contacts' `crm` API key.
4. Invoke `createContact` with a W3C `traceparent`. Contacts reads the credential, calls the port, writes state and logs. The output must be `{ contactId: "c_ada", company: "Acme" }`, and the app must have seen its config, its key and the state it wrote.
5. Check that the management call, both app invocations, the app's callbacks and its log line share the caller's trace ID.

## When it goes red

The assertion names the step, the request and the platform's response body. Read the failing step, fix the cause, and run it again until it is green. When the change adds a feature that this run does not reach, add a step to `live.ts` that drives it through the management API, and assert on what a user would observe.
