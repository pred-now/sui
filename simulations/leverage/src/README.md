# src

The source for the leverage simulation. The parent folder's README explains what the sim
does and how to run it. This file just lists the modules so you can find your way around.

## Modules

- `main.ts`             The entry point. Parses flags and runs the chosen strategy or all of
                        them side by side.
- `cli.ts`              Command-line parsing and the printed comparison.
- `types.ts`            Shared types (a bet, a market, a result).
- `rng.ts`              A seeded random number generator, so runs are repeatable.
- `market.ts`           The fair-probability random walk and how a market resolves.
- `flow.ts`             Generates the stream of incoming leveraged bets.
- `engine.ts`           The core lending engine: netting, the loan book, and equity.
- `policies.ts`         The seven strategies being compared, from naive to the safe design.
- `report.ts`           Aggregates run outcomes into the reported numbers.
- `harden.ts`           Stress tests the chosen strategy and locks the launch settings.
- `elasticity.ts`       Models how strongly traders respond to steering.
- `elasticity-meter.ts` The live estimator that recovers elasticity from flow. This is the
                        same logic ported into the server.
- `capital.ts`          The capital-per-open-interest study behind the 0.14 rule.
