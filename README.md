# Pred

Pred is a leveraged binary prediction market built on Sui, on top of DeepBook Predict.

You bet on yes or no questions like "Will BTC close above 64,000 today". You can bet with
your own money, or borrow from the platform and bet with up to 5x leverage. Trades feel
instant because Pred holds a proxy wallet for each user, so you never sign a transaction or
pay gas yourself. Anyone can also stake USDC into the pool that backs the platform and earn
a share of the real fees.

This repo is a small monorepo. Every folder has its own README that explains it in plain
English, so you can open any folder and understand what lives there.

## Folders

- `server/`      The backend. Node, Express, Redis, and Socket.IO. Holds the betting
                 engine, the money ledger, the LP pool, and the live socket feeds.
- `web/`         The frontend. A Next.js app where people trade, watch their positions,
                 and stake into the pool.
- `docs/`        A documentation website that explains Pred from the basics up to the
                 economic and technical details.
- `simulations/` The offline simulations that designed and stress tested the economic
                 model (the spread, the leverage safety dials, and the capital rule).
- `scripts/`     Small operational scripts, like watching the admin wallet balance.
- `sandbox/`     Throwaway scripts used to learn the on-chain DeepBook Predict API. Not
                 part of the app, and not committed (it is in `.gitignore`).

## The two engines, in one sentence

Pred runs two risk engines. The house engine prices and matches bets so Pred stays neutral
on who wins. The leverage engine lends money and keeps Pred solvent when leveraged users
lose. Both work the same way: match opposing flow for free, gently steer the rest to stay
balanced, hedge or pool the leftover, and hard cap the worst case. The `docs/` site and the
`simulations/` folder explain this in full.

## Running it locally

You need Node, pnpm, and a local Redis. The chain side runs on Sui testnet, where the quote
asset is a mock USDC called DUSDC.

```bash
# backend, serves on :4000
cd server && pnpm install && pnpm dev

# frontend, serves on :3000
cd web && pnpm install && pnpm dev

# docs site
cd docs && pnpm install && pnpm dev
```

The backend reads a `.env` file. Copy `server/.env.template` to `server/.env` and fill it
in. Betting and the pool only switch on when an admin key is set, because that key signs the
on-chain hedges and payouts. Without it the app still runs, just in a read-only mode.

## Tests

```bash
cd server && pnpm test     # the economic model and money paths, ~100 tests
```
