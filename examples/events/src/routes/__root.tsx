/// <reference types="vite/client" />
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

function Bar() {
  const home = useRouterState({ select: (state) => state.location.pathname === "/" });
  return (
    <header className="bar">
      <div className="bar-inner">
        <Link to="/" className="bar-home">
          {home ? "Events" : "All events"}
        </Link>
      </div>
    </header>
  );
}
