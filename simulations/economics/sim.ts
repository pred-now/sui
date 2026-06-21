// Pred economics simulation with real DeepBook Predict oracles
import { writeFileSync } from 'fs';

const SERVER = "https://predict-server.testnet.mystenlabs.com";

// add more predict IDs here as they come online
const PREDICT_IDS = [
    "0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a",
];

const PRICE_SCALE = 1_000_000_000;
const YEAR_MS     = 365.25 * 24 * 60 * 60 * 1000;
const FETCH_DELAY = 150; // ms between oracle state fetches

const CFG = {
    hedgeFloor:   0.01,   // half vault spread floor
    cTail:        0.003,  // tail risk coefficient
    cTime:        0.02,   // time decay coefficient
    cUnc:         0.0,
    kappa:        0.05,   // max steering lean
    riskFraction: 0.02,   // treasury fraction per market
    hardCapMult:  3,
};

const TREASURY  = 10_000;
const N_MARKETS = 50;
const N_BETS    = 200;
const BET_SIZE  = 10;     // contracts per bet
const STUB_VOL  = 0.70;   // fallback: 70% annualized

// Abramowitz & Stegun erf approximation
function erf(x: number): number {
    const s = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t
        - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
}

function normCDF(x: number): number {
    return 0.5 * (1 + erf(x / Math.SQRT2));
}

// ATM binary call: N(d2) where d2 = -vol*sqrt(T)/2
function fairYes(vol: number, tYears: number): number {
    if (tYears <= 0 || vol <= 0) return 0.5;
    return normCDF(-(vol * Math.sqrt(tYears)) / 2);
}

// PRED_ECONOMICS.md: baseHalfSpread
function halfSpread(f: number, T: number, vol: number): number {
    const tail = CFG.cTail * Math.max(0, 1 / (f * (1 - f)) - 4);
    const time = CFG.cTime * (1 - T);
    const unc  = CFG.cUnc * vol;
    return CFG.hedgeFloor + tail + time + unc;
}

function capacity(treasury: number, T: number): number {
    return treasury * CFG.riskFraction * T;
}

// linear skew: k = kappa at |imb| = cap
function skew(imb: number, cap: number): number {
    if (cap === 0) return 0;
    return CFG.kappa * Math.max(-1, Math.min(1, imb / cap));
}

function quote(f: number, T: number, vol: number, imb: number, treasury: number) {
    const cap    = capacity(treasury, T);
    const h      = halfSpread(f, T, vol);
    const k      = skew(imb, cap);
    const yesAsk = Math.max(0, Math.min(1, f + h + k));
    const noAsk  = Math.max(0, Math.min(1, (1 - f) + h - k));
    return { yesAsk, noAsk, h, cap };
}

async function get<T>(path: string): Promise<T> {
    const res = await fetch(`${SERVER}${path}`);
    if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
    return res.json() as Promise<T>;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// fetch from /oracles (global list) -- includes settled, with predict_id field
async function fetchOracles(limit: number) {
    const data = await get<any>('/oracles');
    const all: any[] = Array.isArray(data) ? data : (data.oracles ?? []);
    const now = Date.now();

    // filter to known predict IDs only
    const fromKnown = all.filter(o => PREDICT_IDS.includes(o.predict_id));

    // prefer active, fill remainder with recently settled (have settlement_price)
    const active  = fromKnown.filter(o => o.status === 'active' && Number(o.expiry) > now);
    const settled = fromKnown
        .filter(o => o.status === 'settled' && o.settlement_price)
        .sort((a, b) => Number(b.settled_at) - Number(a.settled_at)); // most recent first

    const combined = [...active, ...settled];
    return combined.slice(0, limit);
}

interface OracleState {
    oracle:        { expiry: number; status: string; underlying_asset: string; activated_at?: number; [k: string]: any };
    latest_price:  { spot: number; [k: string]: any };
}

// try common SVI/vol field names, fall back to stub
function parseVol(state: OracleState): number {
    const lp = state.latest_price as any;
    for (const key of ['atm_vol', 'vol', 'sigma', 'implied_vol', 'iv']) {
        if (typeof lp[key] === 'number' && lp[key] > 0) return lp[key];
    }
    return STUB_VOL;
}

interface Tick {
    tick:      number;
    T:         number;
    yesAsk:    number;
    noAsk:     number;
    spread:    number;  // yesAsk + noAsk - 1 = overround
    imbalance: number;
}

interface MarketResult {
    oracleId:       string;
    asset:          string;
    spotUsd:        number;
    f:              number;
    vol:            number;
    tYears:         number;
    outcome:        'YES' | 'NO';
    startTreasury:  number;
    endTreasury:    number;
    treasuryDelta:  number;
    escrow:         number;
    yesContracts:   number;
    noContracts:    number;
    betsSkipped:    number;
    ticks:          Tick[];
}

function simulateMarket(oracleId: string, state: OracleState, startTreasury: number): MarketResult {
    const expiry      = Number(state.oracle.expiry);
    const activatedAt = Number(state.oracle.activated_at ?? 0);
    const isSettled   = state.oracle.status === 'settled';
    // settled: use full market duration; active: use time remaining
    const tYears = isSettled && activatedAt
        ? Math.max(0.0001, (expiry - activatedAt) / YEAR_MS)
        : Math.max(0.0001, (expiry - Date.now()) / YEAR_MS);
    const vol    = parseVol(state);
    const f      = fairYes(vol, tYears);
    const spot   = state.latest_price.spot / PRICE_SCALE;
    const asset  = (state.oracle.underlying_asset ?? oracleId.slice(0, 8)) as string;

    let escrow       = 0;
    let yesContracts = 0;
    let noContracts  = 0;
    let imbalance    = 0;
    let betsSkipped  = 0;
    const ticks: Tick[] = [];

    for (let tick = 0; tick < N_BETS; tick++) {
        // T_frac: 1 at market open, 0 at expiry
        const T = 1 - tick / N_BETS;
        const q = quote(f, T, vol, imbalance, startTreasury);
        const hardCap = q.cap * CFG.hardCapMult;

        const side      = Math.random() < 0.5 ? 'YES' : 'NO';
        const increases = side === 'YES' ? imbalance >= 0 : imbalance <= 0;

        if (Math.abs(imbalance) >= hardCap && increases) {
            betsSkipped++;
        } else if (side === 'YES') {
            escrow       += BET_SIZE * q.yesAsk;
            yesContracts += BET_SIZE;
            imbalance    += BET_SIZE;
        } else {
            escrow       += BET_SIZE * q.noAsk;
            noContracts  += BET_SIZE;
            imbalance    -= BET_SIZE;
        }

        // hedge excess above capacity
        if (q.cap > 0 && Math.abs(imbalance) > q.cap) {
            const excess = Math.abs(imbalance) - q.cap;
            escrow    -= excess * 2 * CFG.hedgeFloor;
            imbalance  = Math.sign(imbalance) * q.cap;
        }

        ticks.push({
            tick, T,
            yesAsk:    q.yesAsk,
            noAsk:     q.noAsk,
            spread:    q.yesAsk + q.noAsk - 1,
            imbalance,
        });
    }

    const outcome       = Math.random() < f ? 'YES' : 'NO';
    const payout        = outcome === 'YES' ? yesContracts : noContracts;
    const treasuryDelta = escrow - payout;

    return {
        oracleId, asset, spotUsd: spot, f, vol, tYears, outcome,
        startTreasury,
        endTreasury:   startTreasury + treasuryDelta,
        treasuryDelta, escrow,
        yesContracts, noContracts, betsSkipped, ticks,
    };
}

async function main() {
    const log = (s: string) => process.stderr.write(s + '\n');

    log('fetching active oracles...');
    const oracles = await fetchOracles(N_MARKETS);
    log(`found ${oracles.length} active market(s)`);

    if (oracles.length === 0) {
        log('no active markets on testnet');
        process.exit(1);
    }

    const markets: MarketResult[] = [];
    let treasury = TREASURY;

    for (const o of oracles) {
        const id = (o.oracle_id ?? o.id) as string;
        log(`simulating ${o.underlying_asset ?? id.slice(0, 12)}...`);
        const state  = await get<OracleState>(`/oracles/${id}/state`);
        await sleep(FETCH_DELAY);
        const result = simulateMarket(id, state, treasury);
        treasury     = result.endTreasury;
        markets.push(result);
        log(`  f=${result.f.toFixed(3)}  vol=${result.vol.toFixed(2)}  outcome=${result.outcome}  delta=${result.treasuryDelta.toFixed(2)}`);
    }

    const output = {
        config:        CFG,
        betSize:       BET_SIZE,
        nBets:         N_BETS,
        startTreasury: TREASURY,
        endTreasury:   treasury,
        markets,
    };

    writeFileSync('results.json', JSON.stringify(output, null, 2));
    log(`wrote results.json`);
    log(`start=${TREASURY}  end=${treasury.toFixed(2)}  net=${(treasury - TREASURY).toFixed(2)}`);
}

main().catch(e => {
    process.stderr.write(String(e) + '\n');
    process.exit(1);
});
