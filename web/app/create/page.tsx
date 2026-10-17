"use client";

// /create — build a new savings circle.
//
// The form is local state only. On submit we call createCircle(...) through
// useTx, then read the CircleCreated event from the receipt to learn the new
// circle id and redirect to it.
import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { parseEther, parseEventLogs } from "viem";
import { useAccount, useChainId } from "wagmi";
import { partnerAbi } from "@/lib/abi";
import { getChainName, getContractAddress } from "@/lib/config";
import { formatEth } from "@/lib/format";
import { collateralForSlot } from "@/lib/types";
import { useTx } from "@/lib/useTx";
import { Button, Card, Spinner } from "@/components/ui";

const CONTRIBUTION_PRESETS = ["0.001", "0.005", "0.01"];

const DURATION_PRESETS = [
  { label: "2 min (demo)", seconds: 120 },
  { label: "1 day", seconds: 86_400 },
  { label: "1 week", seconds: 604_800 },
];

export default function CreateCirclePage() {
  const router = useRouter();
  const chainId = useChainId();
  const address = getContractAddress(chainId);
  const { isConnected } = useAccount();

  // ----- form state -----
  const [contribution, setContribution] = useState("0.005");
  const [members, setMembers] = useState(4);
  const [duration, setDuration] = useState(120);

  // Parse the typed contribution into wei; 0n means "not valid yet".
  const contributionWei = useMemo(() => {
    try {
      const trimmed = contribution.trim();
      return trimmed === "" ? 0n : parseEther(trimmed);
    } catch {
      return 0n;
    }
  }, [contribution]);

  const contributionValid = contributionWei > 0n;
  const potWei = contributionWei * BigInt(members);

  // Same formula as the contract: contribution * max(1, N - 1 - slot).
  const slotRows = useMemo(
    () => Array.from({ length: members }, (_, slot) => ({ slot, collateral: collateralForSlot(contributionWei, members, slot) })),
    [contributionWei, members],
  );

  // One tx hook for this page. On success we pull the new id from the receipt.
  const tx = useTx({
    onSuccess: (receipt) => {
      const [created] = parseEventLogs({ abi: partnerAbi, logs: receipt.logs, eventName: "CircleCreated" });
      const newId = created?.args.circleId;
      if (newId === undefined) {
        router.push("/");
        return;
      }
      router.push(`/circle/${newId.toString()}`);
    },
  });

  const canSubmit = Boolean(address) && isConnected && contributionValid && !tx.isLoading;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!address) return;

    // Contract call: createCircle(contribution, maxMembers, roundDuration)
    await tx.send(
      {
        abi: partnerAbi,
        address,
        functionName: "createCircle",
        args: [contributionWei, members, BigInt(duration)],
      },
      "Create circle",
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">Create a circle</h1>
        <p className="mt-1 text-sm text-slate-400">
          The creator does not join automatically — after creating, pick a payout slot on the circle page.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* ----- form ----- */}
        <form onSubmit={handleSubmit} className="space-y-6 lg:col-span-3">
          <Card className="space-y-6">
            {/* Contribution */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-200">Contribution per round (ETH)</label>
              <div className="flex flex-wrap gap-2">
                {CONTRIBUTION_PRESETS.map((preset) => (
                  <Button
                    key={preset}
                    variant={contribution === preset ? "primary" : "secondary"}
                    size="sm"
                    onClick={() => setContribution(preset)}
                  >
                    {preset}
                  </Button>
                ))}
                <input
                  inputMode="decimal"
                  value={contribution}
                  onChange={(e) => setContribution(e.target.value)}
                  placeholder="custom"
                  className="w-28 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
                />
              </div>
              {!contributionValid && contribution.trim() !== "" ? (
                <p className="text-xs text-rose-400">Enter a valid amount greater than 0.</p>
              ) : null}
            </div>

            {/* Members */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="members" className="text-sm font-medium text-slate-200">
                  Members (and rounds)
                </label>
                <span className="text-sm font-semibold text-sky-300">{members}</span>
              </div>
              <input
                id="members"
                type="range"
                min={2}
                max={12}
                value={members}
                onChange={(e) => setMembers(Number(e.target.value))}
                className="w-full accent-sky-500"
              />
              <div className="flex justify-between text-xs text-slate-500">
                <span>2</span>
                <span>12</span>
              </div>
            </div>

            {/* Round duration */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-200">Round duration</label>
              <div className="flex flex-wrap gap-2">
                {DURATION_PRESETS.map((preset) => (
                  <Button
                    key={preset.seconds}
                    variant={duration === preset.seconds ? "primary" : "secondary"}
                    size="sm"
                    onClick={() => setDuration(preset.seconds)}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
            </div>
          </Card>

          <div className="space-y-3">
            <Button type="submit" disabled={!canSubmit} className="w-full sm:w-auto">
              {tx.isLoading ? (
                <>
                  <Spinner /> {tx.pendingLabel}
                </>
              ) : (
                "Create circle"
              )}
            </Button>
            {!isConnected ? <p className="text-xs text-slate-500">Connect your wallet to create a circle.</p> : null}
            {isConnected && !address ? (
              <p className="text-xs text-rose-400">
                No contract address configured for {getChainName(chainId)}. Set the NEXT_PUBLIC_ env var.
              </p>
            ) : null}
          </div>
        </form>

        {/* ----- live preview ----- */}
        <div className="space-y-4 lg:col-span-2">
          <Card className="space-y-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Pot per round</p>
              <p className="mt-1 text-2xl font-semibold text-white">{formatEth(potWei)} ETH</p>
              <p className="mt-1 text-xs text-slate-500">
                {members} members × {formatEth(contributionWei)} ETH contribution
              </p>
            </div>

            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Collateral per slot</p>
              <p className="mt-1 text-xs text-slate-500">
                Earlier slots are paid sooner, so they lock more collateral.
              </p>
              <div className="mt-3 max-h-72 overflow-auto rounded-lg border border-slate-800">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-900/80 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Slot</th>
                      <th className="px-3 py-2 font-medium">Paid in</th>
                      <th className="px-3 py-2 text-right font-medium">Collateral</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {slotRows.map(({ slot, collateral }) => (
                      <tr key={slot}>
                        <td className="px-3 py-2 text-slate-300">#{slot}</td>
                        <td className="px-3 py-2 text-slate-400">Round {slot + 1}</td>
                        <td className="px-3 py-2 text-right font-medium text-slate-100">
                          {formatEth(collateral)} ETH
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>

          <p className="text-xs leading-relaxed text-slate-500">
            Need test ETH? Grab some from a{" "}
            <a
              href="https://www.alchemy.com/faucets/ethereum-sepolia"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-400 underline underline-offset-2 hover:text-sky-300"
            >
              Sepolia faucet
            </a>
            . Local Anvil accounts come pre-funded.
          </p>
        </div>
      </div>
    </div>
  );
}
