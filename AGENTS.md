# AGENTS.md

Instructions for coding agents working in this repo. `CLAUDE.md` is a symlink to this file.

Skills live in `.agents/skills/`. `.claude/skills` links to the same directory.

## Effect first

This repo is **effect first**: write TypeScript with the Effect library. Model errors, dependencies, resources, concurrency, and data with Effect's modules (`Effect`, `Layer`, `Schema`, ...) before reaching for a plain TypeScript or third-party equivalent. Leave Effect only where a boundary demands it (framework entry points, third-party callbacks), and convert into Effect at that edge.

When a package does not depend on `effect` yet, run the `effect-ts` skill to add it.

Before writing Effect code, read `node_modules/effect/AGENTS.md` completely and follow its links when required. For APIs the guide does not cover, search the source in `node_modules/effect/src`.
