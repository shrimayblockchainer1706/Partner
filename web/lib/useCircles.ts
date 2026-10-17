"use client";

// Reads `circleCount` and then `getCircle` for every id, newest first.
// Uses a 5s poll so the landing list stays fresh while the page is open.
import { useCallback, useMemo } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import { partnerAbi } from "./abi";
import { getContractAddress, isSupportedChain } from "./config";
import { useReadChainId } from "./hooks";
import { isCircle, type Circle } from "./types";

export const POLL_INTERVAL = 5000;

export type CircleEntry = { id: number; circle: Circle };

export function useCircles() {
  // Read from the wallet's chain when connected, otherwise the default chain.
  const chainId = useReadChainId();
  const address = getContractAddress(chainId);

  // Contract call: circleCount() -> how many circles exist.
  const countQuery = useReadContract({
    abi: partnerAbi,
    address,
    chainId,
    functionName: "circleCount",
    query: { enabled: Boolean(address), refetchInterval: POLL_INTERVAL },
  });

  const count = countQuery.data === undefined ? 0 : Number(countQuery.data);
  const ids = useMemo(() => Array.from({ length: count }, (_, index) => index), [count]);

  // Contract call: getCircle(id) for each id, batched into one multicall.
  const contracts = useMemo(() => {
    if (!address) return [];
    return ids.map((id) => ({
      abi: partnerAbi,
      address,
      chainId,
      functionName: "getCircle" as const,
      args: [BigInt(id)] as const,
    }));
  }, [address, ids, chainId]);

  const circlesQuery = useReadContracts({
    contracts,
    query: { enabled: Boolean(address) && contracts.length > 0, refetchInterval: POLL_INTERVAL },
  });

  const circles = useMemo<CircleEntry[]>(() => {
    const results = circlesQuery.data ?? [];
    return ids
      .map((id, index) => {
        const entry = results[index];
        if (!entry || entry.status !== "success") return null;
        const value = entry.result as unknown;
        return isCircle(value) ? { id, circle: value } : null;
      })
      .filter((entry): entry is CircleEntry => entry !== null)
      .reverse(); // newest (highest id) first
  }, [ids, circlesQuery.data]);

  const refetch = useCallback(async () => {
    await Promise.all([countQuery.refetch(), circlesQuery.refetch()]);
  }, [countQuery, circlesQuery]);

  return {
    circles,
    isLoading: countQuery.isLoading || (contracts.length > 0 && circlesQuery.isLoading),
    isError: countQuery.isError || circlesQuery.isError,
    isSupported: isSupportedChain(chainId),
    isConfigured: Boolean(address),
    chainId,
    refetch,
  };
}
