import type { ReactNode } from "react";

export const metadata = {
  title: "NextBot Gateway",
  description: "GATEWAY PLANE — channel ingress + MCP/model-provider/A2A egress. Not a user-facing surface.",
};

/**
 * Minimal root layout. This app has no rendered pages (Route Handlers only, under
 * `app/api/**`) — this file exists only because Next.js's App Router expects one to
 * be present, not because any request ever renders through it.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
