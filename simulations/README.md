# simulations

The offline simulations that designed and stress tested Pred's economic model before any of
it went into the server. The numbers the server uses (the spread terms, the leverage safety
dials, and the capital rule) come from here.

These are standalone TypeScript programs. They do not touch the chain or the database. They
run many random markets and measure what happens, so the team could pick safe settings with
evidence instead of guesses.

## Folders

- `economics/` The house engine simulation. It models pricing, the spread, internal matching,
               and the treasury that carries the leftover imbalance. It produces the house
               knobs used in the server (`server/lib/econ.ts`).
- `leverage/`  The leverage engine simulation. It compares strategies for handling leverage
               bad debt and validates the safe one: netting, borrow-rate steering, a residual
               hedge, a soft ceiling, and the capital rule. It also includes the live
               elasticity estimator and the capital-ratio study. See its own README for how
               to run each part.
