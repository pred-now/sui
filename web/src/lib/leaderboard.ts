import { API_URL } from "@/components/AuthProvider";

export interface LeaderRow {
    wallet: string; // truncated by the server
    earnings: number; // usd
    roi: number; // percent
}

// public, no auth token
export function getLeaderboard(): Promise<LeaderRow[]> {
    return fetch(`${API_URL}/leaderboard`).then(r => r.json());
}
