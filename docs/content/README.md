# content

The actual documentation, written as Markdown (`.mdx`) files. This is where you edit the
docs. Nextra reads this folder and builds the site from it.

Each subfolder is a section in the sidebar. The `_meta.js` files set the page order and the
titles. `index.mdx` is the landing page.

## Sections

- `basics/`    Gentle explainers for newcomers: what Pred is, how prediction markets work,
               what leverage means, and how to place a trade.
- `economy/`   The economic model in plain English: the two pots of money, the betting
               machine, the lending machine, and the safety wall that keeps it solvent.
- `lp-pool/`   The staking pool: how shares and net asset value work, where the yield comes
               from, how fees and losses flow, withdrawals, and the risks.
- `technical/` The precise math and mechanics: pricing, steering, netting, settlement,
               liquidation, the capital rule, elasticity, custody, and the test harness.

## Adding a page

Create a new `.mdx` file in the right section, then add its name to that section's `_meta.js`
so it appears in the sidebar in the order you want.
