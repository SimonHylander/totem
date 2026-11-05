/// <reference types="vite/client" />
import "@fontsource-variable/figtree";
import "@fontsource-variable/figtree/wght-italic.css";
import { HeadContent, Link, Outlet, Scripts, createRootRoute, useRouterState } from "@tanstack/react-router";
import styles from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [{ charSet: "utf-8" }, { name: "viewport", content: "width=device-width, initial-scale=1" }, { title: "Events" }],
    links: [{ rel: "stylesheet", href: styles }],
  }),
  component: () => (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <Bar />
        <Outlet />
        <Scripts />
      </body>
    </html>
  ),
});

/** The top bar: the app name on the event list, a way back to it everywhere else, and the integrations link. */
function Bar() {
  const home = useRouterState({ select: (state) => state.location.pathname === "/" });
  return (
    <header className="bar">
      <div className="bar-inner">
        <Link to="/" className="bar-home">
          {home ? "Events" : "All events"}
        </Link>
        <Link to="/integrations" className="bar-link">
          Integrations
        </Link>
      </div>
    </header>
  );
}
