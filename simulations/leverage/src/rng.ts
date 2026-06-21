// Deterministic, seedable PRNG so Monte Carlo runs are reproducible.

export class Rng {
    private s: number;

    constructor(seed: number) {
        this.s = seed >>> 0;
    }

    // mulberry32
    next(): number {
        this.s = (this.s + 0x6d2b79f5) >>> 0;
        let t = this.s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    uniform(a: number, b: number): number {
        return a + (b - a) * this.next();
    }

    // Box-Muller standard normal
    normal(mean = 0, std = 1): number {
        const u1 = Math.max(this.next(), 1e-12);
        const u2 = this.next();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        return mean + std * z;
    }

    bernoulli(p: number): boolean {
        return this.next() < p;
    }

    int(nExclusive: number): number {
        return Math.floor(this.next() * nExclusive);
    }
}
