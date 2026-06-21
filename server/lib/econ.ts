// house-engine knobs, mirrors sui/simulations/economics/sim.ts CFG
export const ECON = {
    hedgeFloor: 0.01, // min half-spread, raised to the live vault half-spread
    cTail: 0.003, // widens at the tails
    cTime: 0.02, // widens into expiry
    cUnc: 0.0, // widens on oracle uncertainty (vol)
    cVel: 0.02, // widens on fast one-sided flow, the informed-flow tax
    kappa: 0.05, // max steering lean
    riskFraction: 0.02, // treasury fraction carried per market
    hardCapMult: 3, // hard cap = hardCapMult x band
    stalenessMs: 60_000, // pause quoting if the oracle is older than this
    velocityHalfLifeMs: 60_000, // decay half-life for signed flow
};
