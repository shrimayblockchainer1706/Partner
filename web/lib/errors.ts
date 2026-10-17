// Turns raw wallet/contract errors into short, plain-English sentences.
// The contract's custom errors are read straight from src/Partner.sol.
import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";

// One entry per `error` declared in the Solidity contract.
const CUSTOM_ERRORS: Record<string, string> = {
  InvalidParams: "Those circle settings are not valid.",
  CircleNotOpen: "This circle is not open for joining anymore.",
  CircleNotActive: "This circle is not active yet.",
  SlotOutOfRange: "That payout slot does not exist.",
  SlotTaken: "That slot was already taken.",
  AlreadyMember: "You have already joined this circle.",
  NotMember: "Only members of this circle can do that.",
  IncorrectPayment: "You sent the wrong amount of ETH.",
  AlreadyPaid: "You have already paid this round.",
  ContributionWindowClosed: "This round is closed for contributions.",
  RoundNotOver: "The round is not over and not everyone has paid yet.",
  TransferFailed: "The contract could not send ETH.",
};

// Public entry point: always returns a friendly, non-hex message.
export function friendlyError(error: unknown): string {
  if (!error) return "Something went wrong.";

  if (error instanceof BaseError) {
    // 1) The user closed the MetaMask popup / pressed reject.
    if (error.walk((e) => e instanceof UserRejectedRequestError)) {
      return "You rejected the request in your wallet.";
    }

    // 2) The contract reverted with one of its custom errors.
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const data = reverted.data as { errorName?: string } | undefined;
      const name = data?.errorName;
      if (name && CUSTOM_ERRORS[name]) return CUSTOM_ERRORS[name];
      return reverted.shortMessage || "The contract rejected this transaction.";
    }

    return error.shortMessage || "The transaction failed.";
  }

  // 3) Fallback for provider errors that are not viem BaseErrors.
  const message = error instanceof Error ? error.message : String(error);
  if (/user rejected|user denied|rejected the request/i.test(message)) {
    return "You rejected the request in your wallet.";
  }
  return "Something went wrong. Please try again.";
}
