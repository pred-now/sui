# tests

Jest tests for the economic model and the money paths. This is the safety net for the part
of the system where real money is at stake, so it is thorough.

Most tests run against a small in-memory fake of Redis (`fake-redis.ts`), so they are fast
and need no services running. A couple of tests need a real local Redis.

## Files

- `fake-redis.ts`          The in-memory Redis stand-in used by the unit tests.
- `quote.test.ts`          The house spread, the steering lean, and the price invariants.
- `engine.test.ts`         Placing bets, matching, capacity limits, and settlement payouts.
- `leverage.test.ts`       The leverage math: borrow rate, the ceiling, equity, liquidation.
- `leverage-engine.test.ts`Opening, closing, liquidating, the cliff, the capital gate, the
                           1x guards, and the fee and loss routing to the pool.
- `pool.test.ts`           Pool shares and net asset value, fee and loss accounting, the
                           cooldown, the utilization gate, and an invariant fuzz test.
- `pyth.test.ts`           The independent price cross-check used before liquidations.
- `pubsub.test.ts`         The Redis event channel (needs a local Redis).
- `socket-smoke.ts`        A manual smoke script for the socket feed.

## Running

```bash
pnpm test
```
