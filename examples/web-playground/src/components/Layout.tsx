import type { Child, FC } from "hono/jsx";

export const Layout: FC<{ title: string; children: Child }> = ({
  title,
  children,
}) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title}</title>
      <link rel="stylesheet" href="/styles.css" />
    </head>
    <body>
      <div class="shell">{children}</div>
      <script type="module" src="/app.js"></script>
    </body>
  </html>
);
