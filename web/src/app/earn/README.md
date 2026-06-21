# earn

The Earn page, where people provide capital to the pool that backs Pred and earn a share of
the fees.

The page shows the pool at a glance (total value, share price, how much leverage capacity it
backs, free capital), your own stake and any pending unstake, and a panel to stake, request
an unstake, or claim. It reads the pool over REST and stays fresh from the pool update event
on the socket. Staking moves money from your idle balance into pool shares, so the header
balance updates right away.

Unstaking is a two-step process. You request it, wait out a cooldown, then claim. The page
explains this and shows a live countdown. The matching backend lives in `../../../../server`
(see `lib/pool.ts`, the pool service, and the pool routes).
