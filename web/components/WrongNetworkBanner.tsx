"use client";

// Shows a warning when the wallet is on a chain Partner does not support.
import { useAccount, useSwitchChain } from "wagmi";
import { Button } from "@/components/ui";
import { getChainName, isSupportedChain, SEPOLIA_ID } from "@/lib/config";
import { useMounted } from "@/lib/hooks";

export function WrongNetworkBanner() {
  const mounted = useMounted();
  const { chain } = useAccount();
  const { switchChain, isPending } = useSwitchChain();

  if (!mounted || !chain || isSupportedChain(chain.id)) return null;

  return (
    <div className="border-b border-amber-900/60 bg-amber-950/60">
      <div className="mx-auto flex max-w-5xl flex-col items-start gap-3 px-4 py-3 text-sm text-amber-100 sm:flex-row sm:items-center sm:justify-between">
        <p>
          Your wallet is connected to <span className="font-semibold">{getChainName(chain.id)}</span>. Partner runs on
          Sepolia or Anvil.
        </p>
        <Button size="sm" onClick={() => switchChain({ chainId: SEPOLIA_ID })} disabled={isPending}>
          {isPending ? "Switching…" : "Switch to Sepolia"}
        </Button>
      </div>
    </div>
  );
}
