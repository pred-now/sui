# app

The Next.js app router. Each folder here is a route, and `page.tsx` is the screen for that
route. `layout.tsx` wraps every page with the shared chrome and the providers.

## Routes

- `page.tsx`       The home and main trade screen: the market header, the odds chart, the
                   positions and trade history tables, and the trade panel.
- `earn/`          The Earn page, where people stake into the LP pool.
- `leaderboard/`   The top traders by return.
- `auth/callback/` Where a login provider sends the user back after sign-in.
- `layout.tsx`     The root layout. It mounts the providers (auth, markets, trading) and the
                   header and footer, so every page has live data and a logged-in session.
- `globals.css`    Global styles and the Tailwind theme tokens.
