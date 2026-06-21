"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { getEnokiFlow } from "@/lib/enoki";
import { useAuth } from "@/components/AuthProvider";

export default function AuthCallback() {
    const router = useRouter();
    const { exchange } = useAuth();
    const ran = useRef(false);
    const [error, setError] = useState("");

    useEffect(() => {
        if (ran.current) return;
        ran.current = true;
        (async () => {
            const flow = getEnokiFlow();
            const provider = sessionStorage.getItem("enoki_provider");
            try {
                if (!flow || !provider) throw new Error("login not configured");
                await flow.handleAuthCallback();
                const session = await flow.getSession();
                if (!session?.jwt) throw new Error("no token from provider");
                await exchange("/auth/enoki", { jwt: session.jwt, provider });
                sessionStorage.removeItem("enoki_provider");
                router.replace("/");
            } catch (e) {
                setError(e instanceof Error ? e.message : "login failed");
            }
        })();
    }, [exchange, router]);

    return (
        <div className="flex h-full w-full items-center justify-center text-[13px] text-pred-dim">
            {error ? `Login failed: ${error}` : "Finishing sign in..."}
        </div>
    );
}
