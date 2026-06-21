# server

The Pred backend. It prices and matches bets, lends money for leverage, holds the user
ledger, runs the LP pool, settles markets, and pushes live updates to the web app.

It is a Node app written in TypeScript. It uses Express for REST, Socket.IO for the live
feeds, and Redis as the single source of truth for all fast-moving state (balances,
positions, books, the pool). The slow, on-chain side is Sui testnet through DeepBook
Predict, signed by one admin wallet.

## How it is organized

- `main.ts`     Starts everything: opens Redis, mounts the routes, starts the socket server,
                and kicks off the background services. Betting and money only turn on when
                the admin key is present.
- `lib/`        Pure logic and the Redis data helpers. The math (pricing, spread, leverage,
                the pool) lives here, with no network or framework code.
- `services/`   The long-running pieces: market discovery, the bet engine, settlement,
                liquidation, deposits, the pool, and reconciliation.
- `routes/`     The REST endpoints the web app calls (account, bets, pool, and so on).
- `events/`     The Socket.IO wiring and the Redis pub/sub fan-out for live updates.
- `tests/`      Jest tests for the economic model and the money paths.
- `scripts/`    Operational scripts, like the live testnet bet check.

## The custodial model, in short

Per-user balances are entries in a Redis ledger, not on-chain accounts. Bets, positions,
and the pool all live in Redis too. Only the net leftover risk is hedged on-chain, and only
real withdrawals leave the platform. One admin wallet signs those on-chain actions, so the
user never signs anything. This is what makes trading feel instant.

## Running it

```bash
pnpm install
pnpm dev      # watch mode on :4000
pnpm start    # run once
pnpm test     # the test suite
```

Copy `.env.template` to `.env` first. You also need a local Redis running.
