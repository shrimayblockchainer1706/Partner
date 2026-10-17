"use client";

// useTx — one hook that wraps a contract write plus waiting for its receipt, so
// every button in the app reports the same phases:
//
//   idle      nothing in flight
//   signing   the wallet popup is open, waiting for the user to sign
//   pending   the tx is on chain, waiting for a block
//   success   the tx was mined without reverting
//   error     signing failed, the wallet rejected it, or the tx reverted
//
// It also fires the standard toasts (submitted / confirmed / failed).
import { useEffect, useRef, useState } from "react";
import type { Hash, TransactionReceipt } from "viem";
import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { useToast } from "@/components/Toast";
import { friendlyError } from "./errors";

export type TxStatus = "idle" | "signing" | "pending" | "success" | "error";

// wagmi's writeContractAsync is generic, but extracting its parameters with
// `Parameters<>` collapses the payable overload and forbids `value`. We widen
// the request type so payable calls (joinCircle / contribute) can pass value.
type WriteContractRequest =
  | Parameters<ReturnType<typeof useWriteContract>["writeContractAsync"]>[0]
  | {
      abi: readonly unknown[];
      address: `0x${string}`;
      functionName: string;
      args?: readonly unknown[];
      value?: bigint;
    };

// Label shown on a button while a transaction is in flight.
export const TX_STATUS_LABEL: Record<TxStatus, string> = {
  idle: "",
  signing: "Confirm in wallet…",
  pending: "Pending…",
  success: "Confirmed",
  error: "Failed",
};

export function useTx(options: { onSuccess?: (receipt: TransactionReceipt) => void } = {}) {
  const toast = useToast();
  const { writeContractAsync, reset: resetWrite } = useWriteContract();
  const [hash, setHash] = useState<Hash>();
  const [isSigning, setIsSigning] = useState(false);
  const [signingError, setSigningError] = useState<string>();

  // Keep the latest callback without re-creating `send` on every render.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const receiptQuery = useWaitForTransactionReceipt({ hash });

  // Derive the status rather than storing it, so it can never disagree with wagmi.
  const status: TxStatus = !hash
    ? isSigning
      ? "signing"
      : "idle"
    : receiptQuery.isSuccess
      ? "success"
      : receiptQuery.isError
        ? "error"
        : "pending";

  const error = signingError ?? (receiptQuery.isError ? friendlyError(receiptQuery.error) : undefined);

  // Guard so the confirmation toast fires exactly once per hash.
  const handledHash = useRef<Hash>();

  useEffect(() => {
    if (!hash || !receiptQuery.isSuccess || handledHash.current === hash) return;
    handledHash.current = hash;
    toast.success("Transaction confirmed");
    optionsRef.current.onSuccess?.(receiptQuery.data as TransactionReceipt);
  }, [hash, receiptQuery.isSuccess, receiptQuery.data, toast]);

  useEffect(() => {
    if (!hash || !receiptQuery.isError || handledHash.current === hash) return;
    handledHash.current = hash;
    toast.error(friendlyError(receiptQuery.error));
  }, [hash, receiptQuery.isError, receiptQuery.error, toast]);

  // Send a write. Returns the tx hash, or undefined if the user rejected it.
  const send = async (
    request: WriteContractRequest,
    successMessage?: string,
  ): Promise<Hash | undefined> => {
    setSigningError(undefined);
    setHash(undefined);
    setIsSigning(true);
    try {
      // The request is built from the typed partnerAbi at each call site; the
      // cast just restores wagmi's generic signature that `WriteContractRequest`
      // widened above.
      const txHash = await writeContractAsync(request as Parameters<typeof writeContractAsync>[0]);
      setHash(txHash);
      setIsSigning(false);
      toast.info(successMessage ? `${successMessage} — tx submitted` : "Transaction submitted");
      return txHash;
    } catch (err) {
      setIsSigning(false);
      const message = friendlyError(err);
      setSigningError(message);
      toast.error(message);
      return undefined;
    }
  };

  const reset = () => {
    resetWrite();
    setHash(undefined);
    setIsSigning(false);
    setSigningError(undefined);
    handledHash.current = undefined;
  };

  return {
    send,
    reset,
    status,
    hash,
    error,
    receipt: receiptQuery.data as TransactionReceipt | undefined,
    isLoading: status === "signing" || status === "pending",
    isSuccess: status === "success",
    // Convenience label for buttons.
    pendingLabel: TX_STATUS_LABEL[status],
  };
}
