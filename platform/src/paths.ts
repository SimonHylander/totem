// Platform paths that apps and providers are told about, so they also appear outside the routers.

/** The path apps call platform methods on. `initialize` sends `baseUrl + PLATFORM_METHODS_PATH`. */
export const PLATFORM_METHODS_PATH = "/rpc";

/** OAuth providers redirect to `OAUTH_CALLBACK_PATH/:bindingId`. */
export const OAUTH_CALLBACK_PATH = "/oauth/callback";
