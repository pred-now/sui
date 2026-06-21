import { describe, it, expect } from "@jest/globals";
import {
    imbalanceFraction, borrowRate, maxOI, breachesCeiling, equityOf, accrueInterest, markFor, LEV,
} from "../lib/leverage";
import { ElasticityMeter, recommend } from "../lib/elasticity-meter";

describe("leverage math", () => {
    it("imbalance fraction", () => {
        expect(imbalanceFraction(70, 30)).toBeCloseTo(0.4);
        expect(imbalanceFraction(0, 0)).toBe(0);
    });

    it("crowded side pays more, balancer pays less", () => {
        expect(borrowRate("yes", 70, 30)).toBeGreaterThan(LEV.base); // YES crowded
        expect(borrowRate("no", 70, 30)).toBeLessThan(LEV.base);
    });

    it("rate clamps to [rebateFloor, rateCap]", () => {
        expect(borrowRate("yes", 1e9, 0)).toBeLessThanOrEqual(LEV.rateCap);
        expect(borrowRate("no", 1e9, 0)).toBeGreaterThanOrEqual(LEV.rebateFloor);
    });

    it("maxOI = pool / 0.14", () => {
        expect(maxOI(140)).toBeCloseTo(1000, 6);
    });

    it("soft ceiling breaches when crowding past 20%", () => {
        expect(breachesCeiling(100, 0, "yes", 100, 1)).toBe(true); // imb 1.0 > 0.2
        expect(breachesCeiling(50, 50, "yes", 10, 1)).toBe(false); // imb ~0.09 < 0.2
    });

    it("equityOf marks value - borrowed - fees", () => {
        const { value, equity } = equityOf(100, "yes", 40_000_000, 0, 0, 0, 0.6, 0, 1_000_000);
        expect(value).toBe(60_000_000); // 100 * 0.6 * 1e6
        expect(equity).toBe(20_000_000); // 60 - 40 borrowed
    });

    it("accrueInterest annualizes", () => {
        const year = 365 * 24 * 3600 * 1000;
        expect(accrueInterest(100, 0.1, year)).toBeCloseTo(10, 6);
    });

    it("markFor flips for NO", () => {
        expect(markFor("yes", 0.6)).toBe(0.6);
        expect(markFor("no", 0.6)).toBeCloseTo(0.4);
    });
});

describe("elasticity meter", () => {
    it("recovers the slope through the origin", () => {
        const m = new ElasticityMeter();
        const e = 0.6;
        for (const inc of [0.1, 0.2, 0.3, 0.5, 0.8, 1.0]) m.observe(inc, e * inc);
        expect(m.estimate()).toBeCloseTo(0.6, 6);
    });

    it("recommend raises dynamicK as elasticity falls", () => {
        expect(recommend(1).dynamicK).toBe(4);
        expect(recommend(0.5).dynamicK).toBe(8);
        expect(recommend(0.2).dynamicK).toBe(12); // saturates at kMax
        expect(recommend(0.2).softCeilingFrac).toBe(0.2); // ceiling held
    });
});
