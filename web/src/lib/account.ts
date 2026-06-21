import { API_URL } from "@/components/AuthProvider";
import type { UiPosition, HistItem } from "@/lib/bets";

// base units
export const DUSDC_UNIT = 1_000_000;
export const SUI_UNIT = 1_000_000_000;

export interface Account {
    address: string;
    withdrawAddress: string | null;
    balance: number; // total usd base units
    available: number; // withdrawable usd base units
}

export interface Tx {
    type: "deposit" | "withdraw";
    asset: string; // USDC | SUI
    usd: number; // usd base units
    at: number;
    ref?: string; // coin id (deposit) or tx digest (withdraw)
    to?: string;
}

export async function authed(token: string, path: string, body?: unknown) {
    const res = await fetch(`${API_URL}${path}`, {
        method: body ? "POST" : "GET",
        headers: {
            authorization: `Bearer ${token}`,
            ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? `request failed (${res.status})`);
    }
    return res.json();
}

export function getAccount(token: string): Promise<Account> {
    return authed(token, "/account");
}

export function getTransactions(token: string): Promise<Tx[]> {
    return authed(token, "/transactions");
}

export interface PositionsResponse {
    positions: UiPosition[];
    balance: number;
    available: number;
}

export function getPositions(token: string): Promise<PositionsResponse> {
    return authed(token, "/positions");
}

export function getHistory(token: string): Promise<HistItem[]> {
    return authed(token, "/history");
}

export function setWithdrawAddress(token: string, address: string, confirm = false) {
    return authed(token, "/account/withdraw-address", { address, confirm });
}

export function requestWithdraw(token: string, amount: number, id: string) {
    return authed(token, "/withdraw", { amount, id });
}

export function requestWithdrawSui(token: string, amount: number, id: string) {
    return authed(token, "/withdraw/sui", { amount, id });
}
