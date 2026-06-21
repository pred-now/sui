# web

The Pred frontend. This is where people trade, watch their positions and profit, and stake
into the LP pool. It is a Next.js app written in TypeScript with Tailwind for styling.

It talks to the `../server` backend in two ways. It calls REST endpoints for one-off actions
(log in, fetch account, stake), and it holds a Socket.IO connection for everything live
(quotes, fills, balances, position updates, pool changes). Because the backend holds a proxy
wallet for each user, trades place instantly with no wallet pop-up.

## Layout

- `src/app/`        The pages (Next.js app router): the trade screen, the Earn page, the
                    leaderboard, the login callback, and the shared layout.
- `src/components/` The React components, including the providers that hold app state and
                    the small reusable UI pieces.
- `src/lib/`        Client-side data and helpers: API calls, types, and the pricing math
                    used to draw the chart and preview a bet.
- `src/hooks/`      Small React hooks.
- `public/`         Static images (logos and token icons).

## Running it

```bash
pnpm install
pnpm dev      # serves on :3000
pnpm build    # production build
pnpm start    # run the production build
```

Set `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_SOCKET_URL` to point at the backend (both default
to `http://localhost:4000`).
