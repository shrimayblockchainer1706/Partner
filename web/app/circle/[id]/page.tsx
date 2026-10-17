"use client";

// /circle/[id] — the live view of one savings circle.
//
// Reads (polled every 5s, and refetched after every successful tx):
//   getCircle(id)                      circle settings + status
//   getSlots(id)                       slot -> owner
//   getRoundStatus(id)                 who has paid the current round
//   requiredCollateral(id, slot)       collateral each slot must lock
//   getCollateral(id, account)         the connected member's locked collateral
//   hasPaid(id, round, account)        whether the connected member paid this round
//   getLogs(...)                       the circle's event history
//
// Writes go through useTx so they share the app's toasts + loading phases.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { parseEventLogs } from "viem";
import { useAccount, usePublicClient, useReadContract, useReadContracts } from "wagmi";
import { partnerAbi } from "@/lib/abi";
import {
  DEPLOY_BLOCK,
  DEPLOY_BLOCKS,
  getChainName,
  getContractAddress,
  LOG_LOOKBACK_BLOCKS,
} from "@/lib/config";
import { cx, formatCountdown, formatDuration, formatEth, shortenAddress } from "@/lib/format";
import { useNow, useReadChainId } from "@/lib/hooks";
import { CircleStatus, displayRound, isCircle, type Circle } from "@/lib/types";
import { POLL_INTERVAL } from "@/lib/useCircles";
import { useTx } from "@/lib/useTx";
import { Button, Card, EmptyState, ErrorState, Spinner, Stat, StatusBadge } from "@/components/ui";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const LOG_CHUNK = 5_000n; // keep eth_getLogs ranges small for public RPCs

// Events we replay in the history, mirroring the contract.
const HISTORY_EVENTS = ["Joined", "Contributed", "RoundClosed", "Defaulted", "CircleCompleted"] as const;
type HistoryEventName = (typeof HISTORY_EVENTS)[number];

// Normalised event row, newest first in the list.
type HistoryItem = {
  key: string;
  blockNumber: bigint;
  logIndex: number;
  type: HistoryEventName;
  member?: `0x${string}`;
  recipient?: `0x${string}`;
  round?: number;
  slot?: number;
  amount?: bigint;
  pot?: bigint;
};

// Plain sentence for one history row.
function historySentence(item: HistoryItem): ReactNode {
  const who = (address?: `0x${string}`) => (address ? shortenAddress(address) : "someone");
  switch (item.type) {
    case "Joined":
      return (
        <>
          {who(item.member)} joined slot {item.slot} with {formatEth(item.amount)} ETH collateral
        </>
      );
    case "Contributed":
      return (
        <>
          {who(item.member)} contributed {formatEth(item.amount)} ETH for round {(item.round ?? 0) + 1}
        </>
      );
    case "RoundClosed":
      return (
        <>
          Round {(item.round ?? 0) + 1} closed: {who(item.recipient)} received {formatEth(item.pot)} ETH
        </>
      );
    case "Defaulted":
      return (
        <>
          {who(item.member)} missed round {(item.round ?? 0) + 1}, collateral used
        </>
      );
    case "CircleCompleted":
      return <>Circle completed — collateral refunded</>;
  }
}

export default function CirclePage() {
  const params = useParams<{ id: string }>();
  const rawId = Array.isArray(params?.id) ? params.id[0] : params?.id;
  // Circle ids are non-negative integers.
  const circleId = useMemo(
    () => (rawId !== undefined && /^\d+$/.test(rawId) ? BigInt(rawId) : undefined),
    [rawId],
  );
  const idForCall = circleId ?? 0n;
  const idText = circleId?.toString() ?? rawId ?? "?";

  const { address: account, isConnected } = useAccount();

  // Read-only calls target the wallet's chain once connected, else the default chain.
  const readChainId = useReadChainId();
  const contractAddress = getContractAddress(readChainId);
  const publicClient = usePublicClient({ chainId: readChainId });

  // Contract call: getCircle(id) -> struct with settings + status.
  const circleQuery = useReadContract({
    abi: partnerAbi,
    address: contractAddress,
    chainId: readChainId,
    functionName: "getCircle",
    args: [idForCall],
    query: { enabled: Boolean(contractAddress) && circleId !== undefined, refetchInterval: POLL_INTERVAL },
  });
  const circle = isCircle(circleQuery.data) ? (circleQuery.data as Circle) : undefined;

  const maxMembers = circle?.maxMembers ?? 0;
  const status = circle?.status ?? CircleStatus.Open;
  const isOpen = status === CircleStatus.Open;
  const isActive = status === CircleStatus.Active;
  const isCompleted = status === CircleStatus.Completed;
  const currentRound = circle?.currentRound ?? 0;
  const roundStart = circle?.roundStart ?? 0n;
  const roundDuration = circle?.roundDuration ?? 0n;
  const potWei = (circle?.contribution ?? 0n) * BigInt(maxMembers);

  // Live clock for the round countdown (updates once a second).
  const now = useNow(1000);
  const remaining = Number(roundStart + roundDuration) - now;
  const deadlinePassed = isActive && remaining <= 0;

  // Contract call: getSlots(id) -> owner per slot (address(0) = free).
  const slotsQuery = useReadContract({
    abi: partnerAbi,
    address: contractAddress,
    chainId: readChainId,
    functionName: "getSlots",
    args: [idForCall],
    query: { enabled: Boolean(contractAddress) && circleId !== undefined, refetchInterval: POLL_INTERVAL },
  });
  const slots = slotsQuery.data as readonly `0x${string}`[] | undefined;

  // Contract call: getRoundStatus(id) -> per-slot "paid this round" flags. Active only.
  const roundStatusQuery = useReadContract({
    abi: partnerAbi,
    address: contractAddress,
    chainId: readChainId,
    functionName: "getRoundStatus",
    args: [idForCall],
    query: {
      enabled: Boolean(contractAddress) && circleId !== undefined && isActive,
      refetchInterval: POLL_INTERVAL,
    },
  });
  const roundPaid = roundStatusQuery.data as readonly boolean[] | undefined;
  const everyonePaid = Boolean(roundPaid && roundPaid.length > 0 && roundPaid.every(Boolean));

  // Which slot (if any) belongs to the connected wallet.
  const mySlot = useMemo(() => {
    if (!account || !slots) return undefined;
    const index = slots.findIndex((owner) => owner?.toLowerCase() === account.toLowerCase());
    return index >= 0 ? index : undefined;
  }, [slots, account]);
  const isMember = mySlot !== undefined;

  // Contract call: getCollateral(id, account) -> the connected member's locked ETH.
  const collateralQuery = useReadContract({
    abi: partnerAbi,
    address: contractAddress,
    chainId: readChainId,
    functionName: "getCollateral",
    args: [idForCall, account ?? ZERO_ADDRESS],
    query: { enabled: Boolean(contractAddress) && Boolean(account) && isMember, refetchInterval: POLL_INTERVAL },
  });

  // Contract call: hasPaid(id, currentRound, account) -> did the member pay this round.
  const hasPaidQuery = useReadContract({
    abi: partnerAbi,
    address: contractAddress,
    chainId: readChainId,
    functionName: "hasPaid",
    args: [idForCall, currentRound, account ?? ZERO_ADDRESS],
    query: { enabled: Boolean(contractAddress) && Boolean(account) && isMember, refetchInterval: POLL_INTERVAL },
  });
  const myHasPaid = hasPaidQuery.data === true;

  // Contract call: requiredCollateral(id, slot) for every slot, batched into one multicall.
  const requiredContracts = useMemo(() => {
    if (!contractAddress || circleId === undefined || maxMembers === 0) return [];
    return Array.from({ length: maxMembers }, (_, slot) => ({
      abi: partnerAbi,
      address: contractAddress,
      chainId: readChainId,
      functionName: "requiredCollateral" as const,
      args: [circleId, slot] as const,
    }));
  }, [contractAddress, circleId, maxMembers, readChainId]);

  const requiredQuery = useReadContracts({
    contracts: requiredContracts,
    query: { enabled: requiredContracts.length > 0, refetchInterval: POLL_INTERVAL },
  });
  const requiredBySlot = useMemo(
    () => (requiredQuery.data ?? []).map((entry) => (entry.status === "success" ? (entry.result as bigint) : undefined)),
    [requiredQuery.data],
  );

  // ---------- event history ----------
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyError, setHistoryError] = useState<string>();
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const fetchingLogs = useRef(false);

  useEffect(() => {
    if (!publicClient || !contractAddress || circleId === undefined) return;
    let cancelled = false;

    const fetchLogs = async () => {
      if (fetchingLogs.current) return; // skip ticks while a scan is in flight
      fetchingLogs.current = true;
      try {
        const latest = await publicClient.getBlockNumber();

        // Start block: explicit env override, else per-chain default, else a
        // recent window on public RPCs so ranges stay small.
        let fromBlock = DEPLOY_BLOCK ?? DEPLOY_BLOCKS[readChainId];
        if (fromBlock === undefined) {
          fromBlock = latest > LOG_LOOKBACK_BLOCKS ? latest - LOG_LOOKBACK_BLOCKS : 0n;
        }

        const collected: HistoryItem[] = [];
        // Scan in <=5000-block chunks so public endpoints don't reject the range.
        for (let start = fromBlock; start <= latest; start += LOG_CHUNK) {
          if (cancelled) return;
          const end = start + LOG_CHUNK - 1n > latest ? latest : start + LOG_CHUNK - 1n;
          const raw = await publicClient.getLogs({ address: contractAddress, fromBlock: start, toBlock: end });
          const parsed = parseEventLogs({ abi: partnerAbi, logs: raw, strict: false });

          for (const log of parsed) {
            const name = log.eventName as HistoryEventName | undefined;
            if (!name || !HISTORY_EVENTS.includes(name)) continue;
            const args = log.args as Record<string, unknown> | undefined;
            if (!args || (args.circleId as bigint | undefined) !== circleId) continue;
            collected.push({
              key: `${log.blockNumber ?? 0n}-${log.logIndex ?? 0}`,
              blockNumber: log.blockNumber ?? 0n,
              logIndex: log.logIndex ?? 0,
              type: name,
              member: args.member as `0x${string}` | undefined,
              recipient: args.recipient as `0x${string}` | undefined,
              round: args.round !== undefined ? Number(args.round as bigint) : undefined,
              slot: args.slot !== undefined ? Number(args.slot as bigint) : undefined,
              amount: args.amount as bigint | undefined,
              pot: args.pot as bigint | undefined,
            });
          }
        }

        if (cancelled) return;
        // Newest first: higher block wins, ties broken by log index.
        collected.sort((a, b) =>
          a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : a.blockNumber > b.blockNumber ? -1 : 1,
        );
        setHistory(collected);
        setHistoryError(undefined);
      } catch (err) {
        if (!cancelled) setHistoryError(err instanceof Error ? err.message : "Could not load events.");
      } finally {
        fetchingLogs.current = false;
      }
    };

    fetchLogs();
    const timer = setInterval(fetchLogs, POLL_INTERVAL);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [publicClient, contractAddress, circleId, readChainId, historyRefreshKey]);

  // Members that show up in this circle's Defaulted logs.
  const defaultedMembers = useMemo(
    () => new Set(history.filter((item) => item.type === "Defaulted" && item.member).map((item) => item.member!.toLowerCase())),
    [history],
  );

  // ---------- transactions ----------
  // Refetch every read (and re-scan events) after a tx is mined.
  const refetchAll = async () => {
    await Promise.all([
      circleQuery.refetch(),
      slotsQuery.refetch(),
      roundStatusQuery.refetch(),
      collateralQuery.refetch(),
      hasPaidQuery.refetch(),
      requiredQuery.refetch(),
    ]);
    setHistoryRefreshKey((key) => key + 1);
  };

  const tx = useTx({ onSuccess: () => void refetchAll() });
  const [pendingAction, setPendingAction] = useState<"join" | "contribute" | "close">();

  // Clear the spinner once the tx settles (useTx keeps the hash until reset).
  useEffect(() => {
    if (tx.status === "success" || tx.status === "error" || tx.status === "idle") setPendingAction(undefined);
  }, [tx.status]);

  const run = (action: "join" | "contribute" | "close", send: () => unknown) => {
    setPendingAction(action);
    void send();
  };

  const wrongNetwork = isConnected && !contractAddress;

  // Contribute is valid while active, as a member, unpaid, and inside the window.
  const contributeReason = !isConnected
    ? "Connect your wallet"
    : wrongNetwork
      ? "Switch to the right network"
      : !isMember
        ? "Only members can contribute"
        : myHasPaid
          ? "You already paid this round"
          : deadlinePassed
            ? "Round window closed"
            : undefined;
  const canContribute = Boolean(circle) && isActive && !contributeReason;

  // Close is valid once the deadline passed or everyone has paid; anyone may call it.
  const closeReason = !isConnected
    ? "Connect your wallet"
    : wrongNetwork
      ? "Switch to the right network"
      : !deadlinePassed && !everyonePaid
        ? "Round not finished yet"
        : undefined;
  const canClose = Boolean(circle) && isActive && !closeReason;

  const handleContribute = () =>
    run("contribute", () =>
      tx.send(
        {
          abi: partnerAbi,
          address: contractAddress!,
          functionName: "contribute",
          args: [circleId!],
          value: circle!.contribution,
        },
        "Contribute",
      ),
    );

  const handleClose = () =>
    run("close", () =>
      tx.send(
        { abi: partnerAbi, address: contractAddress!, functionName: "closeRound", args: [circleId!] },
        "Close round",
      ),
    );

  const handleJoin = (slot: number, value: bigint) =>
    run("join", () =>
      tx.send(
        { abi: partnerAbi, address: contractAddress!, functionName: "joinCircle", args: [circleId!, slot], value },
        `Join slot ${slot + 1}`,
      ),
    );

  // ---------- states ----------
  if (circleId === undefined) {
    return <EmptyState title="Circle not found" description="That circle id is not valid." />;
  }

  if (!contractAddress) {
    return (
      <EmptyState
        title="No contract on this network"
        description={
          isConnected
            ? `Your wallet is on ${getChainName(readChainId)}. Switch to Sepolia or Anvil.`
            : `No Partner contract is configured for ${getChainName(readChainId)}.`
        }
      />
    );
  }

  if (circleQuery.isLoading) {
    return (
      <Card className="flex items-center gap-2 text-sm text-slate-400">
        <Spinner /> Loading circle #{idText}…
      </Card>
    );
  }

  if (circleQuery.isError) {
    return <ErrorState message="Could not load this circle from the chain." onRetry={() => void refetchAll()} />;
  }

  // A missing id returns a zeroed struct, so maxMembers === 0 means it does not exist.
  if (!circle || circle.maxMembers === 0) {
    return <EmptyState title="Circle not found" description={`No circle with id #${idText} exists.`} />;
  }

  const contribution = circle.contribution;
  const payoutRound = (slot: number) => slot + 1;

  return (
    <div className="space-y-6">
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200">
        <span aria-hidden>←</span> Back to circles
      </Link>

      {/* ---------- header ---------- */}
      <Card className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Circle</p>
            <h1 className="text-2xl font-semibold tracking-tight text-white">#{idText}</h1>
          </div>
          <StatusBadge status={circle.status} />
        </div>

        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Contribution" value={`${formatEth(contribution)} ETH`} hint="per member / round" />
          <Stat label="Members" value={`${circle.slotsFilled}/${circle.maxMembers}`} hint={`${circle.maxMembers} rounds`} />
          <Stat label="Round duration" value={formatDuration(circle.roundDuration)} />
          <Stat label="Pot size" value={`${formatEth(potWei)} ETH`} hint="contribution × members" />
        </dl>

        <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3">
          {isActive ? (
            <>
              <p className="text-sm font-medium text-slate-100">
                Round {displayRound(currentRound)} of {maxMembers}
              </p>
              <p className={cx("mt-1 text-sm", deadlinePassed ? "text-amber-300" : "text-slate-400")}>
                {deadlinePassed ? "Round ended, anyone can close it" : `Round ends in ${formatCountdown(remaining)}`}
              </p>
            </>
          ) : isOpen ? (
            <p className="text-sm text-slate-400">
              Waiting for members — {circle.maxMembers - circle.slotsFilled} slot
              {circle.maxMembers - circle.slotsFilled === 1 ? "" : "s"} left. The circle starts when the last slot is
              filled.
            </p>
          ) : (
            <p className="text-sm text-slate-400">All {maxMembers} rounds paid out.</p>
          )}
        </div>
      </Card>

      {/* ---------- completed banner ---------- */}
      {isCompleted ? (
        <Card className="space-y-2 border-emerald-800 bg-emerald-950/30">
          <p className="font-medium text-emerald-200">Circle completed, collateral refunded</p>
          {defaultedMembers.size === 0 ? (
            <p className="text-sm text-emerald-200/80">Everyone paid every round — no defaults.</p>
          ) : (
            <div className="text-sm text-emerald-200/80">
              <p>Members who defaulted:</p>
              <ul className="mt-1 list-inside list-disc">
                {Array.from(defaultedMembers).map((member) => (
                  <li key={member}>{shortenAddress(member)}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      ) : null}

      {/* ---------- slots ---------- */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xl font-semibold text-white">Payout slots</h2>
          <span className="text-sm text-slate-500">
            {circle.slotsFilled}/{circle.maxMembers} filled
          </span>
        </div>
        <p className="text-sm text-slate-400">Earlier slots get paid sooner but lock more collateral.</p>
        {isOpen && !isConnected ? (
          <p className="text-xs text-slate-500">Connect your wallet to join a slot.</p>
        ) : null}
        {isOpen && isConnected && isMember ? (
          <p className="text-xs text-slate-500">You are in — waiting for the circle to fill.</p>
        ) : null}

        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: maxMembers }, (_, slot) => {
            const owner = slots?.[slot];
            const isMine = Boolean(account && owner && owner.toLowerCase() === account.toLowerCase());
            const isFree = !owner || owner === ZERO_ADDRESS;
            const required = requiredBySlot[slot];
            const paid = isActive && roundPaid?.[slot] === true;
            const isNext = isActive && slot === currentRound;
            const alreadyReceived = (isActive || isCompleted) && slot < currentRound;
            const defaulted = Boolean(owner && defaultedMembers.has(owner.toLowerCase()));
            const canJoin = isOpen && isConnected && !wrongNetwork && !isMember && isFree && required !== undefined;

            return (
              <li key={slot}>
                <Card className={cx("h-full space-y-3", isMine && "border-sky-600 bg-sky-950/40")}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-500">Slot #{slot}</p>
                      <p className="mt-0.5 text-sm font-medium text-slate-100">
                        {isFree ? (
                          "Open"
                        ) : (
                          <Link
                            href={`/profile/${owner}`}
                            title={owner}
                            className="font-mono text-sky-300 hover:text-sky-200 hover:underline"
                          >
                            {isMine ? "You" : shortenAddress(owner)}
                          </Link>
                        )}
                      </p>
                    </div>
                    <span className="rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-300">
                      Paid in round {payoutRound(slot)}
                    </span>
                  </div>

                  <p className="text-xs text-slate-500">
                    Collateral <span className="text-slate-300">{formatEth(required)} ETH</span>
                  </p>

                  {(paid || isNext || alreadyReceived || defaulted) && (
                    <div className="flex flex-wrap gap-1.5">
                      {isNext ? <Tag tone="sky">Next recipient</Tag> : null}
                      {alreadyReceived ? <Tag tone="emerald">Already received</Tag> : null}
                      {paid ? <Tag tone="slate">Paid this round</Tag> : null}
                      {defaulted ? <Tag tone="rose">Defaulted</Tag> : null}
                    </div>
                  )}

                  {canJoin ? (
                    <Button
                      size="sm"
                      className="w-full"
                      disabled={tx.isLoading}
                      onClick={() => handleJoin(slot, required!)}
                    >
                      {pendingAction === "join" && tx.isLoading ? (
                        <>
                          <Spinner /> {tx.pendingLabel}
                        </>
                      ) : (
                        `Join this slot`
                      )}
                    </Button>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ---------- actions ---------- */}
      {isActive ? (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">Actions</h2>
          <Card className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="flex-1 space-y-1">
              <Button variant="primary" disabled={!canContribute || tx.isLoading} onClick={handleContribute}>
                {pendingAction === "contribute" && tx.isLoading ? (
                  <>
                    <Spinner /> {tx.pendingLabel}
                  </>
                ) : (
                  `Contribute ${formatEth(contribution)} ETH`
                )}
              </Button>
              {contributeReason ? <p className="text-xs text-slate-500">{contributeReason}</p> : null}
            </div>

            <div className="flex-1 space-y-1">
              <Button variant="secondary" disabled={!canClose || tx.isLoading} onClick={handleClose}>
                {pendingAction === "close" && tx.isLoading ? (
                  <>
                    <Spinner /> {tx.pendingLabel}
                  </>
                ) : (
                  "Close round"
                )}
              </Button>
              {closeReason ? <p className="text-xs text-slate-500">{closeReason}</p> : null}
            </div>
          </Card>
        </section>
      ) : null}

      {/* ---------- your position ---------- */}
      {isMember && account ? (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">Your position</h2>
          <Card>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Stat label="Your slot" value={`#${mySlot}`} hint={`Paid in round ${payoutRound(mySlot!)}`} />
              <Stat
                label="Collateral locked"
                value={`${formatEth(collateralQuery.data as bigint | undefined)} ETH`}
                hint={isCompleted ? "refunded" : "returned when the circle completes"}
              />
              <Stat label="Your payout round" value={`Round ${payoutRound(mySlot!)} of ${maxMembers}`} />
            </dl>
          </Card>
        </section>
      ) : null}

      {/* ---------- event history ---------- */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-white">History</h2>
        {historyError ? (
          <p className="text-xs text-rose-400">Could not load events: {historyError}</p>
        ) : history.length === 0 ? (
          <Card className="text-sm text-slate-400">No events yet.</Card>
        ) : (
          <Card className="divide-y divide-slate-800 p-0">
            {history.map((item) => (
              <div key={item.key} className="flex items-baseline justify-between gap-3 px-4 py-3 text-sm">
                <p className="text-slate-200">{historySentence(item)}</p>
                <span className="shrink-0 text-xs text-slate-600">block {item.blockNumber.toString()}</span>
              </div>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}

// Small coloured marker used on slot cards.
function Tag({ tone, children }: { tone: "sky" | "emerald" | "rose" | "slate"; children: ReactNode }) {
  const tones: Record<string, string> = {
    sky: "border-sky-700 bg-sky-950 text-sky-300",
    emerald: "border-emerald-700 bg-emerald-950 text-emerald-300",
    rose: "border-rose-700 bg-rose-950 text-rose-300",
    slate: "border-slate-700 bg-slate-900 text-slate-300",
  };
  return (
    <span className={cx("inline-flex items-center rounded-full border px-2 py-0.5 text-xs", tones[tone])}>
      {children}
    </span>
  );
}
