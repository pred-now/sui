"use client";

import {
    createContext,
    useContext,
    useEffect,
    useState,
    type ReactNode,
} from "react";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export interface SessionUser {
    address: string;
    provider: string;
}

type Status = "loading" | "out" | "in";

interface AuthValue {
    user: SessionUser | null;
    status: Status;
    token: string | null;
    exchange: (path: string, body: unknown) => Promise<void>;
    logout: () => void;
}

const Ctx = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
    const v = useContext(Ctx);
    if (!v) throw new Error("useAuth must be used within AuthProvider");
    return v;
}

const KEY = "pred_session";

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<SessionUser | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [status, setStatus] = useState<Status>("loading");

    // hydrate from a stored session
    useEffect(() => {
        const t = localStorage.getItem(KEY);
        (async () => {
            if (!t) {
                setStatus("out");
                return;
            }
            try {
                const res = await fetch(`${API_URL}/auth/me`, {
                    headers: { authorization: `Bearer ${t}` },
                });
                if (!res.ok) throw new Error("bad session");
                const u = await res.json();
                setToken(t);
                setUser({ address: u.address, provider: u.provider });
                setStatus("in");
            } catch {
                localStorage.removeItem(KEY);
                setStatus("out");
            }
        })();
    }, []);

    // post a credential, store the returned session
    async function exchange(path: string, body: unknown) {
        const res = await fetch(`${API_URL}${path}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const e = await res.json().catch(() => ({}));
            throw new Error(e.error ?? "auth failed");
        }
        const data = await res.json();
        localStorage.setItem(KEY, data.token);
        setToken(data.token);
        setUser({ address: data.address, provider: data.provider });
        setStatus("in");
    }

    function logout() {
        localStorage.removeItem(KEY);
        setToken(null);
        setUser(null);
        setStatus("out");
    }

    return (
        <Ctx.Provider value={{ user, status, token, exchange, logout }}>
            {children}
        </Ctx.Provider>
    );
}
