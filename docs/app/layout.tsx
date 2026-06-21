import type { Metadata } from "next";
import { Noto_Sans, Noto_Serif } from "next/font/google";
import { Footer, Layout, Navbar } from "nextra-theme-docs";
import { Head } from "nextra/components";
import { getPageMap } from "nextra/page-map";

import "nextra-theme-docs/style.css";
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
    title: {
        default: "PRED Docs",
        template: "%s - PRED Docs",
    },
    description: "Documentation for PRED, leveraged prediction markets on Sui.",
};

// brand mark in the navbar
const logo = (
    <span className="pred-brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/pred-logo.svg" alt="PRED" className="pred-brand-mark" />
        <span className="pred-brand-text">Docs</span>
    </span>
);

export default async function RootLayout({ children }: { children: React.ReactNode }) {
    const pageMap = await getPageMap();

    const navbar = <Navbar logo={logo} />;

    const footer = (
        <Footer>
            <span>PRED - Leveraged Prediction Markets on Sui</span>
        </Footer>
    );

    return (
        <html
            lang="en"
            dir="ltr"
            suppressHydrationWarning
            className={`${sans.variable} ${serif.variable}`}
        >
            <Head
                backgroundColor={{ dark: "#052320", light: "#052320" }}
                color={{ hue: 172, saturation: 92, lightness: 58 }}
            />
            <body>
                <Layout
                    navbar={navbar}
                    footer={footer}
                    pageMap={pageMap}
                    docsRepositoryBase="https://github.com/shuding/nextra"
                    darkMode={false}
                    nextThemes={{ defaultTheme: "dark", forcedTheme: "dark" }}
                    sidebar={{ defaultMenuCollapseLevel: 1 }}
                >
                    {children}
                </Layout>
            </body>
        </html>
    );
}
