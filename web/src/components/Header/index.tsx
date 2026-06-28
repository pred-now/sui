"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    ArrowDownToLine,
    ArrowUpFromLine,
    ChevronDown,
    Copy,
    ExternalLink,
    LogOut,
    Receipt,
} from "lucide-react";
import { useDisconnectWallet } from "@mysten/dapp-kit";

import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/components/AuthProvider";
import { useDeposit } from "@/components/Trade/DepositProvider";
import { useWithdraw } from "@/components/Trade/WithdrawProvider";
import LoginModal from "@/components/auth/LoginModal";
import TransactionsModal from "@/components/Trade/TransactionsModal";
import Balances from "@/components/Header/Balances";

const navItems = [
    { label: "Markets", href: "/" },
    { label: "Earn", href: "/earn" },
    { label: "Leaderboard", href: "/leaderboard" },
];

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function Header() {
    const { user, status, logout } = useAuth();
    const { mutate: disconnectWallet } = useDisconnectWallet();
    const { open: openDeposit } = useDeposit();
    const { open: openWithdraw } = useWithdraw();
    const [loginOpen, setLoginOpen] = useState(false);
    const [txOpen, setTxOpen] = useState(false);
    const pathname = usePathname();

    const disconnect = () => {
        disconnectWallet();
        logout();
    };

    return (
        <header className="flex h-13 flex-none items-center gap-3 border-b border-pred-edge/10 bg-pred-deep pr-3 sm:gap-6 sm:pr-4">
            <Image
                src="/pred-logo.svg"
                alt="PRED"
                width={100}
                height={48}
                priority
                className="h-8 w-auto sm:h-10"
            />

            <nav className="flex items-center gap-4 text-xs sm:gap-6">
                {navItems.map((item) => {
                    const active = pathname === item.href;
                    return (
                        <Link
                            key={item.label}
                            href={item.href}
                            className={
                                active
                                    ? "font-semibold text-pred-white hover:text-pred-white"
                                    : "font-medium text-pred-dim hover:text-pred-text"
                            }
                        >
                            {item.label}
                        </Link>
                    );
                })}
            </nav>

            <div className="ml-auto flex items-center gap-1">
                {status !== "in" || !user ? (
                    <Button
                        onClick={() => setLoginOpen(true)}
                        disabled={status === "loading"}
                        className="h-auto bg-pred-green px-4 py-1.75 font-semibold text-pred-ink hover:bg-pred-green/90"
                    >
                        {status === "loading" ? "..." : "Connect"}
                    </Button>
                ) : (
                    <>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="outline"
                                    className="h-8.5 gap-2 border-pred-edge/20 bg-pred-elevated px-3 font-medium text-secondary-foreground hover:border-pred-edge/40 hover:bg-pred-elevated hover:text-pred-text"
                                >
                                    <span className="hidden sm:contents">
                                        <Balances />
                                    </span>
                                    {short(user.address)}
                                    <ChevronDown className="size-3 transition-transform group-data-[state=open]/button:rotate-180" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-auto min-w-52">
                                <DropdownMenuItem
                                    className="cursor-pointer"
                                    onSelect={openDeposit}
                                >
                                    <ArrowDownToLine className="text-pred-dim" />
                                    Deposit
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    className="cursor-pointer"
                                    onSelect={openWithdraw}
                                >
                                    <ArrowUpFromLine className="text-pred-dim" />
                                    Withdraw
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    className="cursor-pointer"
                                    onSelect={() => setTxOpen(true)}
                                >
                                    <Receipt className="text-pred-dim" />
                                    Transactions
                                </DropdownMenuItem>
                                <DropdownMenuSeparator className="bg-pred-edge/10" />
                                <DropdownMenuItem
                                    className="cursor-pointer"
                                    onSelect={() =>
                                        navigator.clipboard?.writeText(user.address)
                                    }
                                >
                                    <Copy className="text-pred-dim" />
                                    Copy address
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    className="cursor-pointer"
                                    onSelect={() =>
                                        window.open(
                                            `https://suiscan.xyz/testnet/account/${user.address}`,
                                            "_blank",
                                            "noopener",
                                        )
                                    }
                                >
                                    <ExternalLink className="text-pred-dim" />
                                    View on explorer
                                </DropdownMenuItem>
                                <DropdownMenuSeparator className="bg-pred-edge/10" />
                                <DropdownMenuItem
                                    variant="destructive"
                                    className="cursor-pointer"
                                    onSelect={disconnect}
                                >
                                    <LogOut />
                                    Disconnect
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </>
                )}
            </div>

            <LoginModal open={loginOpen} onOpenChange={setLoginOpen} />
            <TransactionsModal open={txOpen} onOpenChange={setTxOpen} />
        </header>
    );
}
