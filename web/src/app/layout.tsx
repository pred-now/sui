import type { Metadata, Viewport } from "next";
import { Noto_Sans, Noto_Serif } from "next/font/google";

import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Providers from "@/components/auth/Providers";
import MarketsProvider from "@/components/MarketsProvider";
import TradingProvider from "@/components/Trade/TradingProvider";
import WelcomeBanner from "@/components/Trade/WelcomeBanner";
import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";

const sans = Noto_Sans({
    variable: "--font-sans",
    subsets: ["latin"],
});

const serif = Noto_Serif({
    variable: "--font-serif",
    subsets: ["latin"],
});

export const metadata: Metadata = {
    title: "PRED - Leveraged Prediction Markets",
    description: "Trade prediction markets on PRED. Borrow money and trade with leverage up to 10x.",
};

export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    themeColor: "#041d1a",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html
            lang="en"
            className={`${sans.variable} ${serif.variable} h-full antialiased`}
        >
            <body className="h-full overflow-auto">
                <Providers>
                    <TooltipProvider delayDuration={150}>
                        <MarketsProvider>
                            <TradingProvider>
                                <div
                                    className="flex h-dvh flex-col overflow-hidden bg-pred-bg text-[13px] text-pred-text tabular-nums"
                                    style={{ display: "flex", flexDirection: "column" }}
                                >
                                    <Header />
                                    <WelcomeBanner />
                                    <main className="flex min-h-0 flex-1" style={{ display: "flex", flex: 1, minHeight: 0 }}>
                                        {children}
                                    </main>
                                    <Footer />
                                </div>
                            </TradingProvider>
                        </MarketsProvider>
                    </TooltipProvider>
                </Providers>
            </body>
        </html>
    );
}
