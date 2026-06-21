"use client";

import {
    ResizablePanelGroup,
    ResizablePanel,
    ResizableHandle,
} from "@/components/ui/resizable";
import MarketHeader from "@/components/Trade/MarketHeader";
import PriceChart from "@/components/Trade/PriceChart";
import PositionsPanel from "@/components/Trade/PositionsPanel";
import TradePanel from "@/components/Trade/TradePanel";

export default function TradingLayout() {
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
                                <div className="flex h-full flex-col">
                                    <PriceChart />
                                </div>
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
