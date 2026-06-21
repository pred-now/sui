# lib

Plain TypeScript helpers for the frontend: the API calls, the shared types, and the math
used to draw the chart and preview a bet. No React here, so these are easy to reuse and test.

## API and types

- `account.ts`     Calls the backend for account, transactions, positions, history, and
                   withdrawals. Holds the shared `authed` fetch helper.
- `bets.ts`        Bet and quote types, the live position math (mark, value, equity, profit,
                   liquidation level), the implied liquidation price, and friendly error
                   messages.
- `pool.ts`        The LP pool types and the stake, unstake, and claim API calls.
- `markets.ts`     Market and market-details types, plus formatting helpers (cents, money,
                   countdowns, the market question).
- `leaderboard.ts` The leaderboard type and fetch.

## Math and config

- `odds.ts`     The pricing math used on the client: fair yes probability from the surface,
                the 50 percent strike, the timeframes, and fetching the history surface. This
                mirrors the server so the preview matches the real fill.
- `candles.ts`  Candle fetching and shaping for the chart.
- `config.ts`   On-chain coin types.
- `tokens.ts`   The tokens users can deposit, with icons and decimals.
- `enoki.ts`    Enoki (zkLogin) setup helpers.
- `utils.ts`    Tiny shared helpers, like the `cn` class-name joiner.
