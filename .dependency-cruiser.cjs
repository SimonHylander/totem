// Import boundaries between packages (the layering in AGENTS.md). `pnpm boundaries` checks them,
// and `pnpm verify` runs it after the build. Workspace packages resolve to their built dist, or stay
// unresolved by name before a build, so each rule matches both.

const workspace = (name, dir) => `^(${dir}/|@totem/${name}$)`;
const PLATFORM = workspace("platform", "platform");
const DOMAIN = "^(packages/|@totem/(ids|installs|permissions|runtime|versions)$)";

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "protocol-is-the-base",
      comment: "The protocol is the contract. It imports no other workspace package.",
      severity: "error",
      from: { path: "^protocol/src/" },
      to: { path: "^(platform|packages|sdk|examples)/|^@totem/" },
    },
    {
      name: "sdk-uses-only-the-protocol",
      comment: "The SDK speaks the protocol. It never reaches into the platform or its domain packages.",
      severity: "error",
      from: { path: "^sdk/" },
      to: { path: `${PLATFORM}|${DOMAIN}` },
    },
    {
      name: "domain-stays-pure",
      comment: "Domain packages hold types, transitions and ports. Only the platform provides adapters.",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: PLATFORM },
    },
    {
      name: "domain-has-no-io",
      comment: "Domain packages use Effect and Schema only: no Node built-ins, no HTTP.",
      severity: "error",
      from: { path: "^packages/" },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "domain-has-no-effect-io",
      comment: "Domain packages use Effect and Schema only: no effect/http or other IO modules.",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "effect/dist/(http|http-api|unstable)/" },
    },
    {
      name: "examples-use-the-sdk",
      comment: "Example apps are built like third-party apps, on the SDK and protocol only. live.ts scripts boot a platform to run them.",
      severity: "error",
      from: { path: "^examples/", pathNot: "/live\\.ts$" },
      to: { path: `${PLATFORM}|${DOMAIN}|^@totem/example-` },
    },
    {
      name: "examples-stand-alone",
      comment: "An example app does not import another example. live.ts scripts compose them.",
      severity: "error",
      from: { path: "^examples/([^/]+)/", pathNot: "/live\\.ts$" },
      to: { path: "^examples/", pathNot: "^examples/$1/" },
    },
  ],
  options: {
    // Built packages and third-party code are import targets, never cruised themselves.
    doNotFollow: { path: "node_modules|/dist/" },
    exclude: { path: "routeTree\\.gen\\.ts$" },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "types", "default"],
    },
  },
};
