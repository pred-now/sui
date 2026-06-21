# scripts

Small operational scripts that sit next to the project but are not part of the app. Run them
by hand when you need them.

## Files

- `watch-admin-funds.ts` Watches the admin wallet and reports its balance over time. Handy
                         for keeping an eye on the wallet that signs hedges and payouts.

## Running

```bash
pnpm install
pnpm watch-admin-funds
```
