import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";
import { WrongNetworkBanner } from "@/components/WrongNetworkBanner";

export const metadata: Metadata = {
  title: "Partner — trustless savings circles",
  description: "A trustless rotating savings circle (chit fund / committee) on Ethereum.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        <Providers>
          <div className="flex min-h-screen flex-col">
            <Header />
            <WrongNetworkBanner />
            <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:py-10">{children}</main>
            <footer className="border-t border-slate-800 py-6 text-center text-xs text-slate-500">
              Partner — trustless savings circles. Testnet MVP, do not use real funds.
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
