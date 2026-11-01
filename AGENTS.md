# AGENTS.md

Instructions for coding agents working in this repo. `CLAUDE.md` is a symlink to this file.

Skills live in `.agents/skills/`. `.claude/skills` links to the same directory.

Read [`docs/contract.md`](docs/contract.md) before adding a feature, a shared module, or a dependency between packages.

## Effect first

This repo is **effect first**: write TypeScript with the Effect library. Model errors, dependencies, resources, concurrency, and data with Effect's modules (`Effect`, `Layer`, `Schema`, ...) before reaching for a plain TypeScript or third-party equivalent. Leave Effect only where a boundary demands it (framework entry points, third-party callbacks), and convert into Effect at that edge.

When a package does not depend on `effect` yet, run the `effect-ts` skill to add it.

Before writing Effect code, read `node_modules/effect/AGENTS.md` completely and follow its links when required. For APIs the guide does not cover, search the source in `node_modules/effect/src`.

## No comments

Do not write code comments. Agents copy what already exists, so one comment explaining a workaround spreads. Fix what a comment would explain instead: rename, extract a named function, use a type or Schema, or write a test. A reason that belongs to a decision goes in an ADR, and a known gap goes in `docs/open-questions.md`.

`totem/no-comments` (`eslint-rules/no-comments.mjs`) enforces this. It allows only:

- JSDoc on an exported declaration or one of its members. An `ADR nnnn` it names must exist.
- `quirk:` notes about behaviour we cannot change, such as a browser or a vendor API.
- `@ts-expect-error` and `eslint-disable` directives that give a reason.

## Layers

```
protocol  <-  packages/* (domain)  <-  platform
protocol  <-  sdk/javascript-sdk  <-  examples
```

Domain packages hold types, pure rules and ports (`Context.Service`), with Effect and Schema only. The platform provides the adapters as `Layer`s. `pnpm boundaries` checks the arrows.

To add a domain package, copy `packages/installs`: `model.ts`, `transitions.ts`, `errors.ts`, `port.ts`, `index.ts` and a table test.

A decision that crosses packages gets an ADR in `docs/decisions/`, then an update to `docs/open-questions.md`.

## Done

`pnpm verify` runs typecheck, lint, tests and boundaries, as CI does. For a change to platform, SDK, protocol or domain behaviour, also run the `verify-totem` skill.
