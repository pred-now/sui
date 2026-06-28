"use client";

import {
    ResizablePanelGroup,
    ResizablePanel,
    ResizableHandle,
} from "@/components/ui/resizable";
import { useMediaQuery } from "@/hooks/use-media-query";
import MarketHeader from "@/components/Trade/MarketHeader";
import PriceChart from "@/components/Trade/PriceChart";
import PositionsPanel from "@/components/Trade/PositionsPanel";
import TradePanel from "@/components/Trade/TradePanel";

function Chart() {
    return (
        <div className="flex h-full flex-col">
            <PriceChart />
        </div>
    );
}

function DesktopLayout() {
    return (
        <ResizablePanelGroup
            autoSaveId="pred-cols"
            direction="horizontal"
            className="h-full w-full"
        >
            <ResizablePanel defaultSize={74} minSize={40}>
                <div className="flex h-full flex-col">
                    <MarketHeader />
                    <div className="min-h-0 flex-1">
                        <ResizablePanelGroup autoSaveId="pred-rows" direction="vertical">
                            <ResizablePanel defaultSize={66} minSize={25}>
                                <Chart />
                            </ResizablePanel>
                            <ResizableHandle withHandle />
                            <ResizablePanel defaultSize={34} minSize={15}>
                                <PositionsPanel />
                            </ResizablePanel>
                        </ResizablePanelGroup>
                    </div>
                </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={26} minSize={16}>
                <TradePanel />
            </ResizablePanel>
        </ResizablePanelGroup>
    );
}

function MobileLayout() {
    return (
        <div className="flex h-full w-full flex-col overflow-y-auto">
            <MarketHeader />
            <div className="h-[60vh] min-h-80 flex-none border-b border-pred-edge/10">
                <Chart />
            </div>
            <TradePanel />
            <div className="h-105 flex-none border-t border-pred-edge/10">
                <PositionsPanel />
            </div>
        </div>
    );
}

export default function TradingLayout() {
    const isDesktop = useMediaQuery("(min-width: 1024px)");
    return isDesktop ? <DesktopLayout /> : <MobileLayout />;
}
