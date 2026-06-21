# lp-pool

The staking pool, explained for someone who wants to provide capital and earn yield. The
pool is the money that stands behind Pred's risk. Stakers earn a share of the fees and take
the losses if the pool ever has to cover bad debt.

## Pages

- `overview.mdx`         What the pool is and what it backs.
- `staking-and-nav.mdx`  Shares and net asset value: how your stake is priced and grows.
- `yield.mdx`            Where the yield comes from (real fees, not token rewards).
- `fees-and-losses.mdx`  How each fee and each loss moves the pool's value.
- `withdrawals.mdx`      The unstake request, the cooldown, and the claim.
- `risks.mdx`            The honest risks of providing this capital.

The server side of the pool lives in `../../../server` (see `lib/pool.ts` and the pool
service and routes). The staking screen lives in `../../../web` under the Earn page.
