# technical

The precise mechanics and math. This section is the source of truth for how the code
behaves. If a number or formula in the server is unclear, it is explained here.

## Pages

- `overview.mdx`     How the technical pieces fit together.
- `pricing.mdx`      The fair odds and the risk-priced spread.
- `steering.mdx`     The gentle lean that keeps the book balanced for free.
- `netting.mdx`      Matching opposite bets so they cancel and cost nothing.
- `settlement.mdx`   How a market resolves and pays out.
- `liquidation.mdx`  When a leveraged position is closed, and the safety checks around it.
- `capital-rule.mdx` How much capital the pool must hold per unit of leveraged exposure.
- `elasticity.mdx`   The one thing measured from live flow, and how it is used.
- `custody.mdx`      The proxy wallets and the rule that keeps custody safe.
- `harness.mdx`      The simulation harness that validated all of the above.

These pages mirror the code in `../../../server/lib` and `../../../server/services`.
