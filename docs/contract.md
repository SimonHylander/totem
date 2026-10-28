# Codebase contract

How we write and structure this codebase. Read it before adding a feature, a shared module, or a dependency between packages.

## Design input

A coding agent optimizes for what fits in its context. It:

- copies the nearest working pattern
- edits the file already open
- takes the shortest path that compiles
- keeps code whose callers it cannot see
- follows the requested implementation, even when it conflicts with a system invariant

We treat these behaviors as inputs to the framework design. The codebase is shaped so that each of them produces correct code.

## Rules

1. **The conventional path takes fewer decisions than a shortcut.** The nearest working pattern is the right one to copy, and the shortest path that compiles is the intended path.
2. **Forbidden dependencies fail mechanically.** A type, lint or build check rejects them. Review is a second guard, never the only one.
3. **Every durable value has one obvious writer.** Any other code that needs to change the value goes through that writer.
4. **New product work adds isolated files.** It leaves shared roots unchanged, so the work stays inside files the agent can see and delete whole.
5. **Exceptions are narrow, explicit and reviewed as architecture changes.** Record each one as a decision in [`decisions/`](decisions/) that names the rule it breaks and the scope it covers.

The framework's five public nouns carry these rules.

## Features

A feature creates an owned folder. Its entrypoints and transcript cards are reserved files inside that folder. The framework discovers them by file name, so no shared inventory lists them.

Adding a feature adds a folder. Removing a feature deletes the folder.
