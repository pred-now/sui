# services

The long-running pieces of the backend. Each service is a class that either loops in the
background or is called by the routes and sockets. They use the helpers in `../lib` to do
the actual work.

## Market data

- `discovery.ts`       Watches the chain for new and settled markets and tracks them.
- `market-details.ts`  Fetches and caches full market state, and refreshes active markets.
- `candles.ts`         Builds and serves price candles for the chart.
- `surface.ts`         Serves the merged forward and volatility surface for client pricing.

## Money and custody

- `custody.ts`       Manages the per-user proxy wallets.
- `treasury.ts`      The admin wallet. Holds the reserve and signs on-chain hedges, mints,
                     redeems, and payouts.
- `user.ts`          User lookup and creation.
- `deposits.ts`      Watches for incoming deposits and credits the ledger.
- `withdrawals.ts`   Pays out withdrawals, capped at the user's equity.
- `reconcile.ts`     Periodically checks that the ledgers, the pool, and the reserve agree.

## The bet engine and its loops

- `engine.ts`         The heart. Quotes, places, and closes bets. Matches opposite flow,
                      hedges the leftover, runs the capacity and capital gates, and routes
                      fees and losses to the pool. Single writer per market.
- `settlement.ts`     Settles resolved markets, pays positions, closes leftover leverage,
                      and redeems the platform's hedges.
- `liquidation.ts`    Marks leveraged positions, liquidates underwater ones (after a delay
                      and a Pyth cross-check), and runs the deleverage cliff near expiry.
- `leverage-meter.ts` Reads the live elasticity meter and tunes the steering dial.
- `pool.ts`           Seeds the LP pool from the reserve and, on mainnet, moves idle funds
                      to a yield venue. The Margin part is off on testnet.

All of these are started from `../main.ts`.
