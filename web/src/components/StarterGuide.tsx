"use client";

import { useEffect, useRef, useState } from "react";
import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";

import { useAuth } from "@/components/AuthProvider";

const SEEN = "pred:onboarded";
const ANCHOR = '[data-tour="market"]';

const steps: DriveStep[] = [
    {
        element: '[data-tour="market"]',
        popover: {
            title: "Pick a market",
            description:
                "Browse markets here and switch anytime. Each one settles at a set time.",
        },
    },
    {
        element: '[data-tour="outcome"]',
        popover: {
            title: "Choose a side",
            description:
                "Buy YES if you think it happens, NO if it won't. The price is the implied chance.",
        },
    },
    {
        element: '[data-tour="leverage"]',
        popover: {
            title: "Add leverage",
            description: "Size up your position with leverage. More upside, more risk.",
        },
    },
    {
        element: '[data-tour="amount"]',
        popover: {
            title: "Set your amount",
            description:
                "Enter how much to bet, then check the payout and liquidation below.",
        },
    },
    {
        element: '[data-tour="place"]',
        popover: {
            title: "Place your bet",
            description: "Review the summary and confirm to open your position.",
        },
    },
    {
        element: '[data-tour="deposit"]',
        popover: {
            title: "Fund your account",
            description: "Deposit USDC or SUI to start trading. Welcome to PRED!",
        },
    },
];

function runTour() {
    const present = steps.filter((s) => document.querySelector(s.element as string));
    if (present.length === 0) return;
    driver({
        showProgress: true,
        allowClose: true,
        overlayColor: "rgba(4, 20, 18, 0.72)",
        stagePadding: 6,
        stageRadius: 8,
        popoverClass: "pred-tour",
        nextBtnText: "Next",
        prevBtnText: "Back",
        doneBtnText: "Got it",
        steps: present,
    }).drive();
}

export default function StarterGuide() {
    const { status } = useAuth();
    const prev = useRef(status);
    const [armed, setArmed] = useState(false);

    // arm only on a fresh connect (out -> in), once per browser
    useEffect(() => {
        const was = prev.current;
        prev.current = status;
        if (was === "out" && status === "in" && localStorage.getItem(SEEN) !== "1") {
            setArmed(true);
        }
    }, [status]);

    // wait for the trade page elements, then run once
    useEffect(() => {
        if (!armed) return;
        let tries = 0;
        const id = setInterval(() => {
            tries += 1;
            if (document.querySelector(ANCHOR)) {
                clearInterval(id);
                localStorage.setItem(SEEN, "1");
                setArmed(false);
                runTour();
            } else if (tries > 40) {
                clearInterval(id);
                setArmed(false);
            }
        }, 400);
        return () => clearInterval(id);
    }, [armed]);

    return null;
}
