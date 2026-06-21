import { API_URL } from "@/components/AuthProvider";
import { authed } from "@/lib/account";

// mirrors the server GET /pool payload (money fields are usd base units)
export interface PoolInfo {
    assets: number;
    shares: number;
    sharePrice: number;
    protocol: number;
    hot: number;
    supplied: number;
    leveragedOI: number;
    maxOI: number;
    freeCapital: number;
    stakerShare: number;
    cooldownMs: number;
    enabled: boolean;
}

export interface PoolClaim {
    shares: number;
    requestedAt: number;
}

export interface PoolPosition {
    shares: number;
    value: number;
    sharePrice: number;
    claim: PoolClaim | null;
}

// pool overview is public so logged-out users can see the vault
export async function getPool(): Promise<PoolInfo> {
    const res = await fetch(`${API_URL}/pool`);
    if (!res.ok) throw new Error("pool unavailable");
    return res.json();
}

export const getPoolPosition = (token: string): Promise<PoolPosition> => authed(token, "/pool/position");
export const poolStake = (token: string, amount: number) => authed(token, "/pool/stake", { amount });
export const poolUnstake = (token: string, shares: number) => authed(token, "/pool/unstake", { shares });
export const poolClaim = (token: string) => authed(token, "/pool/claim", {});
