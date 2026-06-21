"use client";

import Image from "next/image";
import { ChevronDown, Check } from "lucide-react";

import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { TOKENS, type TokenDef } from "@/lib/tokens";

// token picker shared by deposit and withdraw
export default function TokenSelect({
    token,
    onChange,
}: {
    token: TokenDef;
    onChange: (t: TokenDef) => void;
}) {
    return (
        <div>
            <div className="mb-1.5 text-xs text-pred-dim">Token</div>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button className="flex w-full items-center justify-between rounded-lg border border-pred-edge/15 bg-pred-input px-3 py-2.5 text-[13px] font-semibold text-pred-text transition-colors hover:border-pred-edge/30">
                        <span className="flex items-center gap-2">
                            <Image src={token.icon} alt={token.label} width={18} height={18} className="size-4.5" />
                            {token.label}
                        </span>
                        <ChevronDown className="size-4 text-pred-dim" />
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                    align="start"
                    className="w-(--radix-dropdown-menu-trigger-width)"
                >
                    {TOKENS.map(t => (
                        <DropdownMenuItem
                            key={t.key}
                            className="cursor-pointer gap-2"
                            onSelect={() => onChange(t)}
                        >
                            <Image src={t.icon} alt={t.label} width={18} height={18} className="size-4.5" />
                            {t.label}
                            {t.key === token.key && <Check className="ml-auto size-4 text-pred-green" />}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}
