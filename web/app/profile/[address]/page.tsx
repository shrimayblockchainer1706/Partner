"use client";

// /profile/[address] — reputation and circle memberships for one address.
//
// Reads (polled every 5s):
//   getScore(address)   -> completed circles + lifetime defaults
//   circleCount()       -> how many circles exist
//   getSlots(id)        -> per circle, which slot (if any) this address owns
//   getCircle(id)       -> settings + status for the matching circles
// The two per-circle lists are fetched with useReadContracts so every circle is
// read in a single batched multicall.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getAddress, isAddress } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { partnerAbi } from "@/lib/abi";
import { getChainName, getContractAddress } from "@/lib/config";
import { formatEth, shortenAddress } from "@/lib/format";
import { useReadChainId } from "@/lib/hooks";
import { isCircle, type Circle } from "@/lib/types";
import { POLL_INTERVAL } from "@/lib/useCircles";
import { useToast } from "@/components/Toast";
import { Button, Card, EmptyState, ErrorState, Spinner, StatusBadge } from "@/components/ui";

type TrustLevel = "new" | "trusted" | "risky";

// Trust heuristic: any default makes an address risky; otherwise completed
// circles earn trust, and a blank slate is simply "New".
function trustFor(completed: bigint, defaults: bigint): TrustLevel {
  if (defaults > 0n) return "risky";
  if (completed > 0n) return "trusted";
  return "new";
}

const TRUST_COPY: Record<TrustLevel, { label: string; tone: string; explain: string }> = {
  new: {
    label: "New",
    tone: "border-sky-700 bg-sky-950 text-sky-300",
    explain: "No completed circles yet — this address has not finished a circle.",
  },
  trusted: {
    label: "Trusted",
    tone: "border-emerald-700 bg-emerald-950 text-emerald-300",
    explain: "Completed at least one circle without ever missing a payment.",
  },
  risky: {
    label: "Risky",
    tone: "border-rose-700 bg-rose-950 text-rose-300",
    explain: "Has missed payments in a past circle — collateral was used.",
  },
};

// getScore returns two uint256 values; viem can hand these back as an array or
// as a named object depending on the ABI, so normalise both shapes.
function readScore(data: unknown): { completed: bigint; defaults: bigint } | undefined {
  if (data === undefined || data === null) return undefined;
  if (Array.isArray(data)) {
    return { completed: (data[0] as bigint) ?? 0n, defaults: (data[1] as bigint) ?? 0n };
  }
  const value = data as { completed?: bigint; defaulted?: bigint; defaults?: bigint };
  if (value.completed !== undefined) {
    return { completed: value.completed, defaults: value.defaulted ?? value.defaults ?? 0n };
  }
  return undefined;
}

type Membership = { id: number; slot: number; circle?: Circle };

export default function ProfilePage() {
  const params = useParams<{ address: string }>();
  const rawAddress = Array.isArray(params?.address) ? params.address[0] : params?.address;
  const toast = useToast();

  // Normalise to a checksummed address; invalid input shows an error state.
  const address = useMemo(() => {
    if (rawAddress === undefined || !isAddress(rawAddress)) return undefined;
    try {
      return getAddress(rawAddress);
    } catch {
      return undefined;
    }
  }, [rawAddress]);

  const readChainId = useReadChainId();
  const contractAddress = getContractAddress(readChainId);

  const [copied, setCopied] = useState(false);

  // Contract call: circleCount() -> number of circles to scan.
  const countQuery = useReadContract({
    abi: partnerAbi,
    address: contractAddress,
    chainId: readChainId,
    functionName: "circleCount",
    query: { enabled: Boolean(contractAddress), refetchInterval: POLL_INTERVAL },
  });
  const count = countQuery.data === undefined ? 0 : Number(countQuery.data);
  const ids = useMemo(() => Array.from({ length: count }, (_, index) => index), [count]);

  // Contract call: getScore(address) -> (completed circles, lifetime defaults).
  const scoreQuery = useReadContract({
    abi: partnerAbi,
    address: contractAddress,
    chainId: readChainId,
    functionName: "getScore",
    args: [address ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: Boolean(contractAddress) && address !== undefined, refetchInterval: POLL_INTERVAL },
  });
  const score = readScore(scoreQuery.data);

  // Contract call: getSlots(id) for every circle, batched into one multicall.
  const slotsContracts = useMemo(() => {
    if (!contractAddress) return [];
    return ids.map((id) => ({
      abi: partnerAbi,
      address: contractAddress,
      chainId: readChainId,
      functionName: "getSlots" as const,
      args: [BigInt(id)] as const,
    }));
  }, [contractAddress, ids, readChainId]);
  const slotsQuery = useReadContracts({
    contracts: slotsContracts,
    query: { enabled: slotsContracts.length > 0, refetchInterval: POLL_INTERVAL },
  });

  // Contract call: getCircle(id) for every circle, batched into one multicall.
  const circlesContracts = useMemo(() => {
    if (!contractAddress) return [];
    return ids.map((id) => ({
      abi: partnerAbi,
      address: contractAddress,
      chainId: readChainId,
      functionName: "getCircle" as const,
      args: [BigInt(id)] as const,
    }));
  }, [contractAddress, ids, readChainId]);
  const circlesQuery = useReadContracts({
    contracts: circlesContracts,
    query: { enabled: circlesContracts.length > 0, refetchInterval: POLL_INTERVAL },
  });

  // Circles where the address owns a slot, newest first.
  const memberships = useMemo<Membership[]>(() => {
    if (!address) return [];
    const target = address.toLowerCase();
    const slotResults = slotsQuery.data ?? [];
    const circleResults = circlesQuery.data ?? [];

    const found: Membership[] = [];
    ids.forEach((id, index) => {
      const slotEntry = slotResults[index];
      if (!slotEntry || slotEntry.status !== "success") return;
      const owners = slotEntry.result as readonly `0x${string}`[];
      const slot = owners.findIndex((owner) => owner?.toLowerCase() === target);
      if (slot < 0) return;

      const circleEntry = circleResults[index];
      const circle =
        circleEntry && circleEntry.status === "success" && isCircle(circleEntry.result)
          ? (circleEntry.result as Circle)
          : undefined;
      found.push({ id, slot, circle });
    });
    return found.reverse();
  }, [address, ids, slotsQuery.data, circlesQuery.data]);

  const refetchAll = async () => {
    await Promise.all([countQuery.refetch(), scoreQuery.refetch(), slotsQuery.refetch(), circlesQuery.refetch()]);
  };

  const copyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      toast.success("Address copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy the address.");
    }
  };

  // ---------- states ----------
  if (rawAddress !== undefined && !address) {
    return <EmptyState title="Invalid address" description="That is not a valid Ethereum address." />;
  }

  if (!contractAddress) {
    return (
      <EmptyState
        title="No contract on this network"
        description={`No Partner contract is configured for ${getChainName(readChainId)}.`}
      />
    );
  }

  const isLoading =
    countQuery.isLoading ||
    scoreQuery.isLoading ||
    (slotsContracts.length > 0 && slotsQuery.isLoading) ||
    (circlesContracts.length > 0 && circlesQuery.isLoading);

  if (isLoading) {
    return (
      <Card className="flex items-center gap-2 text-sm text-slate-400">
        <Spinner /> Loading profile…
      </Card>
    );
  }

  if (countQuery.isError || scoreQuery.isError || slotsQuery.isError || circlesQuery.isError) {
    return <ErrorState message="Could not load this profile from the chain." onRetry={() => void refetchAll()} />;
  }

  const trust = trustFor(score?.completed ?? 0n, score?.defaults ?? 0n);
  const trustInfo = TRUST_COPY[trust];

  return (
    <div className="space-y-6">
      {/* ---------- identity + trust ---------- */}
      <Card className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-slate-500">Profile</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="font-mono text-lg font-semibold text-white" title={address}>
                {shortenAddress(address)}
              </span>
              <Button variant="secondary" size="sm" onClick={copyAddress}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
          <span className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium ${trustInfo.tone}`}>
            {trustInfo.label}
          </span>
        </div>

        <p className="text-sm text-slate-400">{trustInfo.explain}</p>

        <dl className="grid grid-cols-2 gap-4 sm:max-w-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Completed circles</dt>
            <dd className="mt-1 text-sm font-medium text-slate-100">{score?.completed?.toString() ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Defaults</dt>
            <dd className="mt-1 text-sm font-medium text-slate-100">{score?.defaults?.toString() ?? "—"}</dd>
          </div>
        </dl>
      </Card>

      {/* ---------- memberships ---------- */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xl font-semibold text-white">Circles</h2>
          <span className="text-sm text-slate-500">{memberships.length} joined</span>
        </div>

        {memberships.length === 0 ? (
          <EmptyState title="This address has not joined any circle yet" />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {memberships.map(({ id, slot, circle }) => (
              <li key={id}>
                <Link
                  href={`/circle/${id}`}
                  className="block rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                >
                  <Card className="transition hover:border-slate-600">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-slate-500">Circle</p>
                        <p className="text-lg font-semibold text-white">#{id}</p>
                      </div>
                      {circle ? <StatusBadge status={circle.status} /> : null}
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <dt className="text-xs text-slate-500">Your slot</dt>
                        <dd className="mt-0.5 font-medium text-slate-100">#{slot}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-500">Contribution</dt>
                        <dd className="mt-0.5 font-medium text-slate-100">
                          {circle ? `${formatEth(circle.contribution)} ETH` : "—"}
                        </dd>
                      </div>
                    </dl>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
