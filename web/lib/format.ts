// Small display helpers. Every ETH value in the app goes through formatEth so
// numbers stay short and readable (e.g. 0.003 instead of 0.003000000000000001).
import { formatEther } from "viem";

// wei -> ETH string, up to `decimals` decimal places with trailing zeros removed.
export function formatEth(wei: bigint | undefined | null, decimals = 6): string {
  if (wei === undefined || wei === null) return "—";
  const value = formatEther(wei);
  const [whole, fraction] = value.split(".");
  if (!fraction) return whole;
  const trimmed = fraction.slice(0, decimals).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

// "0x1234567890abcdef..." -> "0x1234…cdef"
export function shortenAddress(address?: string, chars = 4): string {
  if (!address) return "";
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`;
}

// Human readable round duration: 120 -> "2 min".
export function formatDuration(seconds: number | bigint): string {
  const s = Number(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}

// Countdown clock: "0:45" or "1:05:00". Zero or negative means the round is over.
export function formatCountdown(remainingSeconds: number): string {
  if (remainingSeconds <= 0) return "round over";
  const total = Math.floor(remainingSeconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

// Unix seconds -> local date/time string, used in the event history.
export function formatTimestamp(seconds: bigint | number): string {
  return new Date(Number(seconds) * 1000).toLocaleString();
}

// Tiny classname joiner (avoids pulling in a library like clsx).
export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
