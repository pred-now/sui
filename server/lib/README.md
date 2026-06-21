# lib

The pure logic and the Redis data helpers. Files here have no Express or Socket.IO code.
They hold the math and the small functions that read and write Redis state, so they are easy
to test and reuse. The services in `../services` wire these together.

## Setup and chain

- `env.ts`      Reads and validates environment variables.
- `redis.ts`    Creates the Redis client.
- `sui.ts`      Sui client setup and shared constants (the clock, base units).
- `config.ts`   On-chain coin types and ids.
- `predict.ts`  Small helpers for talking to the DeepBook Predict REST API.

## Markets and pricing

- `market.ts`         Market and market-details shapes, Redis keys, and the events channel.
- `pricing.ts`        Fair yes probability from the oracle surface (the SVI digital call).
- `candles.ts`        OHLC candle aggregation from accumulated price history.
- `quote.ts`          The risk-priced spread and the steering lean (the house quote).
- `econ.ts`           The house-engine knobs (spread terms, capacity fractions).
- `vault.ts`          Builds the DeepBook Predict market key and reads vault trade amounts.

## The book and positions

- `book.ts`       The per-market book: internal yes and no, hedged amount, and flow velocity.
- `positions.ts`  A user's plain (unleveraged) position in one market.
- `ledger.ts`     The per-user USD ledger: balance, locked, debt, fees, and the equity rule.
- `txlog.ts`      The deposit and withdrawal history log.

## Leverage and the pool

- `leverage.ts`         The leverage knobs and math: borrow rate steering, the soft ceiling,
                        equity, the liquidation level, and the elasticity-tuned dial.
- `levbook.ts`          Leveraged positions, the long and short book, and the cohort capital
                        reservation (the live 0.14 rule).
- `elasticity-meter.ts` Estimates how much traders respond to steering, from live flow.
- `pyth.ts`             An independent Pyth price, used to sanity check the oracle before a
                        liquidation (fail closed if they disagree).
- `pool.ts`             The LP vault: shares and net asset value, fee and loss routing, the
                        capital gate, and the unstake cooldown.
- `history.ts`          The closed-bet (trade history) log.
- `bus.ts`              Publishes events to the Redis fan-out and names the socket rooms.
