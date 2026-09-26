# 0002: JSON-RPC 2.0 over HTTP

Status: Accepted (2026-09-25)

## Context

Apps can be hosted by the platform or by the third party. The transport should not change between the two.

## Decision

The protocol uses JSON-RPC 2.0 over HTTP. Streaming, such as events and long running calls, uses SSE on the same connection.

- Platform hosted app: the platform runs the container and calls it over HTTP.
- Remote app: the platform calls the app's URL over HTTP.

Hosting is a deployment choice. The protocol is identical in both cases.

Both directions authenticate. The platform signs requests to the app. The app authenticates its calls back to the platform.

## Rejected

- **stdio.** Only helps local development, and a localhost HTTP server covers that.

## Consequences

- Every app is an HTTP server. SDKs provide that server.
- The signing scheme is still to be designed (see [open questions](../open-questions.md)).
