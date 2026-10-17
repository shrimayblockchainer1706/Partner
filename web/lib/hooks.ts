"use client";

// Tiny hooks used to keep server and client renders in sync and to drive the
// live countdown on the circle page.
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { DEFAULT_CHAIN_ID } from "./config";

// Chain used for read-only contract calls: the wallet's chain once connected,
// otherwise the configured default chain. Keeps reads working with no wallet.
export function useReadChainId(): number {
  const { isConnected, chainId } = useAccount();
  return isConnected && chainId !== undefined ? chainId : DEFAULT_CHAIN_ID;
}

// `true` only after the component has mounted in the browser. Wallet state
// (address, chain) is unknown during SSR, so we gate that UI behind this to
// avoid React hydration mismatches.
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

// Current unix time in seconds, refreshed every `intervalMs`. Used for the
// round countdown.
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
