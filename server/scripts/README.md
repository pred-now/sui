# scripts

Operational scripts for the server. These are run by hand, not part of the running app.

## Files

- `live-bet-test.ts` A live check against Sui testnet and a local Redis. It reads the
                     platform reserve, picks a live market, cross-checks the oracle against
                     Pyth, gets a vault quote and a house quote, places a couple of bets that
                     net against each other, and cleans up its own test state afterward.

Run it with flags to go further:

```bash
tsx scripts/live-bet-test.ts            # quote and internal bets, no chain spend
tsx scripts/live-bet-test.ts --hedge    # also forces one real vault hedge
tsx scripts/live-bet-test.ts --leverage # also opens and closes a small 3x position
```

Use this to confirm the whole path works end to end on testnet. It needs the admin key in
`.env`.
