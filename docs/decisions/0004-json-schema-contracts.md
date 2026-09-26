# 0004: JSON Schema is the source of truth for contracts

Status: Accepted (2026-09-25)

## Context

Contracts must be readable by every SDK language and by agents. A TS-first schema such as zod only works for TypeScript.

## Decision

Manifests and all message payloads are defined in JSON Schema. Each SDK generates its own typed bindings from those schemas.

## Consequences

- Types stay checked end to end in every language, through code generation.
- Agents read the same schemas to discover and call app capabilities.
- Every SDK needs a codegen step.
