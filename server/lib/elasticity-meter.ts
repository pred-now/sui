// Live elasticity instrumentation, ported from the validated sim
// (sui/simulations/leverage/src/elasticity-meter.ts). The steering layer offers a rebate
// incentive in [0,1] to crowd-side borrowers; a fraction flip to the balancing side. That
// fraction is the elasticity, unknown until real flow. Feed every steering decision in and
// read it out. Model: P(flip | incentive) = elasticity * incentive (slope through origin).

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

    stderr(): number {
        const e = this.estimate();
        return this.sxx > 1e-9 && this.n > 1 ? Math.sqrt(Math.max(0, e * (1 - e)) / this.sxx) : NaN;
    }

    get samples() {
        return this.n;
    }

    // serialize the two running sums so the estimate survives restarts
    snapshot() {
        return { sxx: this.sxx, sxy: this.sxy, n: this.n };
    }
    restore(s: { sxx: number; sxy: number; n: number }) {
        this.sxx = s.sxx;
        this.sxy = s.sxy;
        this.n = s.n;
    }
}

export interface Recommendation {
    dynamicK: number;
    softCeilingFrac: number;
    mode: string;
}

// Map a measured elasticity to launch knobs. The ceiling bounds the imbalance regardless of
// response, so solvency does not depend on elasticity; elasticity sets the rejection rate.
// Hold steering effectiveness (~ K * e) at the design level by raising K as e falls.
export function recommend(eMeas: number, designK = 4, baseCeiling = 0.2, kMax = 12, designE = 1): Recommendation {
    const e = Math.max(eMeas, 0.05);
    const k = clamp((designK * designE) / e, designK, kMax);
    const mode = k >= kMax ? "max steering (response is the limit)" : "steer harder";
    return { dynamicK: Math.round(k * 10) / 10, softCeilingFrac: baseCeiling, mode };
}
