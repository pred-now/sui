"use client";

import { useSyncExternalStore } from "react";
import { X } from "lucide-react";

const KEY = "pred:welcome-dismissed";
const subs = new Set<() => void>();

function subscribe(cb: () => void) {
    subs.add(cb);
    return () => subs.delete(cb);
}

// persisted across reloads
const isDismissed = () => localStorage.getItem(KEY) === "1";
const dismiss = () => {
    localStorage.setItem(KEY, "1");
    subs.forEach(cb => cb());
};

export default function WelcomeBanner() {
    const dismissed = useSyncExternalStore(subscribe, isDismissed, () => false);
    if (dismissed) return null;

    return (
        <div className="flex flex-none items-center gap-3 bg-pred-white px-4 py-1.5 text-[12.5px] font-medium text-pred-ink">
            <span>
                Welcome to PRED. Prediction markets meet with leverage.{" "}
                <a href="https://docs.pred.now" className="text-pred-accent underline">
                    Get started here.
                </a>
            </span>
            <button
                onClick={dismiss}
                aria-label="Dismiss"
                className="ml-auto cursor-pointer text-pred-ink/70 hover:text-pred-ink"
            >
                <X className="size-4" />
            </button>
        </div>
    );
}
