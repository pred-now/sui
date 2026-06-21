# routes

The REST endpoints the web app calls. Each file builds an Express router. They are thin:
they check the input, call into `../services` or `../lib`, and return JSON. Anything that
needs a logged-in user goes through the session guard.

## Files

- `index.ts`       Public market data: snapshots, details, candles, and the price surface.
- `auth.ts`        Login. Exchanges a Slush, Enoki, or Privy credential for a session token.
- `session.ts`     The `requireSession` guard that reads the bearer token and sets the user.
- `account.ts`     Account overview, transaction history, withdrawal address, and withdrawals.
- `bet.ts`         The unified bet surface: quote, place, close, list positions, and history.
- `pool.ts`        The LP pool: overview, your position, stake, request unstake, and claim.
- `leaderboard.ts` Top traders by return.

Most write endpoints expect an idempotency id, so a retried request never double counts.
