// Shared types + tiny helpers describing the on-chain data.

// Mirrors the `Circle` struct in src/Partner.sol.
export type Circle = {
  creator: `0x${string}`;
  contribution: bigint; // wei per member per round
  roundDuration: bigint; // seconds
  roundStart: bigint; // unix seconds the current round began
  maxMembers: number; // also the number of rounds
  currentRound: number; // 0-based
  slotsFilled: number;
  status: number; // 0 = Open, 1 = Active, 2 = Completed
};

// Mirrors the `CircleStatus` enum in the contract.
export const CircleStatus = {
  Open: 0,
  Active: 1,
  Completed: 2,
} as const;

const STATUS_LABELS = ["Open", "Active", "Completed"];

export function statusLabel(status: number | undefined): string {
  if (status === undefined) return "…";
  return STATUS_LABELS[status] ?? "Unknown";
}

// A circle is only meaningful once its struct has loaded.
export function isCircle(value: unknown): value is Circle {
  return !!value && typeof value === "object" && "maxMembers" in (value as Circle);
}

// Payout slot a member gets paid in: slot i is paid in round i, so an earlier
// slot means being paid sooner (and locking more collateral).
export function collateralForSlot(contribution: bigint, maxMembers: number, slot: number): bigint {
  const roundsOwed = maxMembers - 1 - slot;
  return contribution * BigInt(roundsOwed > 1 ? roundsOwed : 1);
}

// We display rounds as "Round 1" instead of the contract's 0-based index.
export function displayRound(currentRound: number): number {
  return currentRound + 1;
}
