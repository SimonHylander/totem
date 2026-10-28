# AGENTS.md

Instructions for coding agents working in this repo. `CLAUDE.md` is a symlink to this file.

Skills live in `.agents/skills/`. `.claude/skills` links to the same directory.

## Effect first

This repo is **effect first**: write TypeScript with the Effect library. Model errors, dependencies, resources, concurrency, and data with Effect's modules (`Effect`, `Layer`, `Schema`, ...) before reaching for a plain TypeScript or third-party equivalent. Leave Effect only where a boundary demands it (framework entry points, third-party callbacks), and convert into Effect at that edge.

When a package does not depend on `effect` yet, run the `effect-ts` skill to add it.

Before writing Effect code, read `node_modules/effect/AGENTS.md` completely and follow its links when required. For APIs the guide does not cover, search the source in `node_modules/effect/src`.

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
