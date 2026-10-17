"use client";

// Top navigation bar: app name, links, and the wallet connection controls.
// Only the injected (MetaMask) connector is offered — no WalletConnect id needed.
import Link from "next/link";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { Button } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { getChainName } from "@/lib/config";
import { friendlyError } from "@/lib/errors";
import { shortenAddress } from "@/lib/format";
import { useMounted } from "@/lib/hooks";

export function Header() {
  // Wallet state is unknown during SSR, so wait for mount before rendering it.
  const mounted = useMounted();
  const toast = useToast();

  const { address, isConnected, chain } = useAccount();
  const { connectors, connectAsync, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  // connectors[0] is the injected connector configured in lib/wagmi.ts
  const injectedConnector = connectors[0];

  const handleConnect = async () => {
    if (!injectedConnector) {
      toast.error("No browser wallet found. Please install MetaMask.");
      return;
    }
    try {
      await connectAsync({ connector: injectedConnector });
    } catch (error) {
      toast.error(friendlyError(error));
    }
  };

  return (
    <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-3 py-3 sm:px-4">
        <Link href="/" className="text-lg font-semibold tracking-tight text-white">
          Partner
        </Link>

        <nav className="flex items-center gap-1">
          {/* The brand links home too, so Home is hidden on the narrowest screens. */}
          <Link
            href="/"
            className="hidden rounded-lg px-2 py-1.5 text-sm text-slate-300 hover:bg-slate-800 hover:text-white sm:block sm:px-3"
          >
            Home
          </Link>
          <Link href="/create" className="rounded-lg px-2 py-1.5 text-sm text-slate-300 hover:bg-slate-800 hover:text-white sm:px-3">
            Create
          </Link>
          {/* Profile shortcut appears only once a wallet is connected. */}
          {mounted && isConnected && address ? (
            <Link
              href={`/profile/${address}`}
              className="rounded-lg px-2 py-1.5 text-sm text-slate-300 hover:bg-slate-800 hover:text-white sm:px-3"
            >
              My Profile
            </Link>
          ) : null}
        </nav>

        <div className="flex items-center gap-2">
          {mounted && isConnected && address ? (
            <>
              <span
                title={address}
                className="hidden rounded-lg border border-slate-800 px-3 py-1.5 font-mono text-xs text-slate-300 md:block"
              >
                {shortenAddress(address)}
              </span>
              <span className="hidden rounded-lg border border-slate-800 px-2 py-1 text-xs text-slate-400 md:block">
                {getChainName(chain?.id)}
              </span>
              <Button variant="secondary" size="sm" onClick={() => disconnect()}>
                Disconnect
              </Button>
            </>
          ) : (
            // Also rendered on the server, so there is no empty flash before hydration.
            <Button size="sm" onClick={handleConnect} disabled={isPending}>
              {isPending ? "Connecting…" : "Connect Wallet"}
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
