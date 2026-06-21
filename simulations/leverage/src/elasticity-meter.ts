// Live elasticity instrumentation. The steering layer offers a rebate incentive in [0,1]
// to crowd-side orders; a fraction of them flip to the balancing side. That fraction is the
// elasticity, and it is unknown until real money trades. Feed every steering decision in
// (the incentive offered, whether the order flipped) and read the elasticity back out.
//
// Model: P(flip | incentive) = elasticity * incentive, so elasticity is the slope of a
// regression of flipped on incentive through the origin.

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export class ElasticityMeter {
    private sxx = 0;
    private sxy = 0;
    private n = 0;

    observe(incentive: number, flipped: number) {
        this.sxx += incentive * incentive;
        this.sxy += incentive * flipped;
        this.n++;
    }

    estimate(): number {
        return this.sxx > 1e-9 ? clamp(this.sxy / this.sxx, 0, 1) : NaN;
    }

    // 1-sigma error on the slope, so you know when you have measured enough
    stderr(): number {
        const e = this.estimate();
        return this.sxx > 1e-9 && this.n > 1 ? Math.sqrt(Math.max(0, e * (1 - e)) / this.sxx) : NaN;
    }

    get samples() {
        return this.n;
    }
}

export interface Recommendation {
    dynamicK: number;
    softCeilingFrac: number;
    mode: string;
}

// Map a measured elasticity to launch knobs. The ceiling already bounds the imbalance below
// the break regardless of response, so solvency does not depend on elasticity; elasticity sets
// the rejection rate. Hold steering effectiveness (~ K * e) at the design level by raising K
// as e falls, which recovers UX (fewer orders reach the wall). Keep the ceiling where the
// stress test put it. If e is so low that K saturates, the residual rejection is inherent and
// the lever is lower max leverage, not a tighter ceiling.
export function recommend(eMeas: number, designK = 4, baseCeiling = 0.2, kMax = 12, designE = 1): Recommendation {
    const e = Math.max(eMeas, 0.05);
    const k = clamp((designK * designE) / e, designK, kMax);
    const mode = k >= kMax ? "max steering (response is the limit)" : "steer harder";
    return { dynamicK: Math.round(k * 10) / 10, softCeilingFrac: baseCeiling, mode };
}
