# Header

The top bar of the app.

- `index.tsx`    The header itself: the logo, the navigation (Markets, Earn, Leaderboard),
                 and either a Connect button or the account menu (deposit, withdraw,
                 transactions, copy address, disconnect).
- `Balances.tsx` The live account balance shown in the header. It updates instantly from
                 trading events and falls back to a short poll.
