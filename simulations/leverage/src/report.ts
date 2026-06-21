import type { Aggregate, Metrics, Policy } from "./types.js";

// mean of per-run metrics, plus the insolvency rate across runs
export function aggregate(runs: Metrics[]): Aggregate {
    const n = runs.length || 1;
    let cost = 0, costA = 0, rej = 0, liq = 0, del = 0;
    let bd = 0, dd = 0, inc = 0, end = 0, ins = 0, lock = 0, cut = 0, nk = 0, rs = 0;
    for (const r of runs) {
        const pos = Math.max(1, r.positions);
        cost += r.sumCostPctStake / pos;
        costA += r.sumCostAnnual / pos;
        rej += r.rejected / Math.max(1, r.attempts);
        liq += r.liquidated / pos;
        del += r.deleveraged / pos;
        bd += r.badDebt;
        dd += r.maxDrawdown;
        inc += r.income;
        end += r.endingTreasury;
        ins += r.insolvent ? 1 : 0;
        lock += r.lockedPeak;
        cut += r.payoutCutPct;
        nk += r.peakNaked;
        rs += r.rateStd;
    }
    return {
        avgBorrowCostPctStake: (cost / n) * 100,
        avgBorrowCostAnnual: (costA / n) * 100,
        rejectedShare: (rej / n) * 100,
        liquidatedShare: (liq / n) * 100,
        deleveragedShare: (del / n) * 100,
        badDebt: bd / n,
        maxDrawdown: dd / n,
        income: inc / n,
        endingTreasury: end / n,
        insolventFrac: (ins / n) * 100,
        lockedPeak: lock / n,
        payoutCutPct: (cut / n) * 100,
        peakNaked: (nk / n) * 100,
        rateStd: (rs / n) * 100, // percentage points
    };
}

const money = (x: number) =>
    (x < 0 ? "-$" : "$") + Math.abs(x).toLocaleString("en-US", { maximumFractionDigits: 0 });
const pct = (x: number) => `${x.toFixed(2)}%`;
const cell = (s: string, w = 14) => s.padStart(w);

function row(label: string, b: string, w: string, a: string): string {
    return "  " + label.padEnd(34) + cell(b) + cell(w) + cell(a);
}

export function printScenario(p: Policy, best: Aggregate, worst: Aggregate, mc: Aggregate): void {
    console.log("");
    console.log(`== ${p.title} [${p.key}] ==`);
    console.log(`   ${p.blurb}`);
    console.log(row("", "best", "worst", "avg(MC)"));
    console.log("  " + "-".repeat(34 + 14 * 3));
    const line = (label: string, f: (a: Aggregate) => string) =>
        console.log(row(label, f(best), f(worst), f(mc)));

    line("user borrow cost (% of stake)", a => pct(a.avgBorrowCostPctStake));
    line("user borrow cost (annualized)", a => pct(a.avgBorrowCostAnnual));
    line("trades rejected/capped", a => pct(a.rejectedShare));
    line("positions force-liquidated", a => pct(a.liquidatedShare));
    line("positions force-deleveraged", a => pct(a.deleveragedShare));
    line("avg naked imbalance (book-wtd)", a => pct(a.peakNaked));
    line("borrow rate volatility (pp)", a => `${a.rateStd.toFixed(1)}pp`);
    line("max payout cut vs requested", a => pct(a.payoutCutPct));
    line("Pred bad debt", a => money(a.badDebt));
    line("max treasury drawdown", a => money(a.maxDrawdown));
    line("premium + fee income", a => money(a.income));
    line("ending treasury", a => money(a.endingTreasury));
    line("treasury capital locked (peak)", a => money(a.lockedPeak));
    line("runs ending insolvent", a => pct(a.insolventFrac));
}

export interface SummaryRow {
    policy: Policy;
    mc: Aggregate;
    worst: Aggregate;
}

// one-line-per-scenario UX-vs-safety comparison, best UX at the top
export function printSummary(rows: SummaryRow[]): void {
    console.log("");
    console.log("================ cross-scenario summary (UX -> safety) ================");
    const head =
        "  " +
        "scenario".padEnd(26) +
        cell("cost%stk", 10) +
        cell("costAnn", 10) +
        cell("rej%", 8) +
        cell("liq%", 8) +
        cell("wBadDebt", 12) +
        cell("wInsol%", 9) +
        cell("endTreas", 12);
    console.log(head);
    console.log("  " + "-".repeat(26 + 10 + 10 + 8 + 8 + 12 + 9 + 12));
    for (const { policy, mc, worst } of rows) {
        console.log(
            "  " +
                policy.key.padEnd(26) +
                cell(mc.avgBorrowCostPctStake.toFixed(1), 10) +
                cell(`${mc.avgBorrowCostAnnual.toFixed(0)}%`, 10) +
                cell(mc.rejectedShare.toFixed(1), 8) +
                cell(mc.liquidatedShare.toFixed(1), 8) +
                cell(money(worst.badDebt), 12) +
                cell(worst.insolventFrac.toFixed(1), 9) +
                cell(money(mc.endingTreasury), 12),
        );
    }
    console.log("");
    console.log("  cost%stk/costAnn/rej%/liq% are Monte-Carlo averages; wBadDebt/wInsol% are worst-case.");
}
