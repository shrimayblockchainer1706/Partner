// Central config: supported chains, contract addresses and RPC endpoints.
//
// Everything here can be overridden with NEXT_PUBLIC_* env vars so the same
// build works against Sepolia or a local Anvil node (see .env.example).
import { sepolia, anvil } from "wagmi/chains";

// The two chains this app understands.
export const SEPOLIA_ID = sepolia.id; // 11155111
export const ANVIL_ID = anvil.id; // 31337
export const SUPPORTED_CHAIN_IDS: number[] = [SEPOLIA_ID, ANVIL_ID];

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// Public RPC by default so no API key is needed. Point this at your own
// provider with NEXT_PUBLIC_SEPOLIA_RPC_URL if the public node is busy.
export const SEPOLIA_RPC_URL =
  process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";

// Anvil always runs on the local machine, so it stays fixed.
export const ANVIL_RPC_URL = "http://127.0.0.1:8545";

export const CHAIN_NAMES: Record<number, string> = {
  [SEPOLIA_ID]: "Sepolia",
  [ANVIL_ID]: "Anvil",
};

// Chain used for read-only calls while no wallet is connected. Defaults to
// Sepolia; set NEXT_PUBLIC_DEFAULT_CHAIN=anvil for local development.
export const DEFAULT_CHAIN_ID: number =
  process.env.NEXT_PUBLIC_DEFAULT_CHAIN === "anvil" ? ANVIL_ID : SEPOLIA_ID;

// Only trust env values that look like real addresses.
function parseAddress(value: string | undefined): `0x${string}` | undefined {
  return value && /^0x[0-9a-fA-F]{40}$/.test(value) ? (value as `0x${string}`) : undefined;
}

function parseBlock(value: string | undefined): bigint | undefined {
  if (!value) return undefined;
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

// Address of the deployed Partner contract per chain.
// - Sepolia: set NEXT_PUBLIC_PARTNER_ADDRESS_SEPOLIA after you deploy.
// - Anvil: defaults to the address produced by `forge script script/Deploy.s.sol`
//   with Anvil's first default account.
export const CONTRACT_ADDRESSES: Record<number, `0x${string}`> = {
  [SEPOLIA_ID]: parseAddress(process.env.NEXT_PUBLIC_PARTNER_ADDRESS_SEPOLIA) ?? ZERO_ADDRESS,
  [ANVIL_ID]: parseAddress(process.env.NEXT_PUBLIC_PARTNER_ADDRESS_ANVIL) ??
    "0x5FbDB2315678afecb367f032d93F642f64180aa3",
};

// First block to scan when replaying events. On Sepolia we default to a recent
// window so public RPCs don't reject huge ranges; on Anvil the chain is tiny.
export const LOG_LOOKBACK_BLOCKS = 50_000n;
// One explicit start block for every chain, set with NEXT_PUBLIC_DEPLOY_BLOCK.
// It takes precedence over the per-chain values below.
export const DEPLOY_BLOCK = parseBlock(process.env.NEXT_PUBLIC_DEPLOY_BLOCK);
export const DEPLOY_BLOCKS: Record<number, bigint | undefined> = {
  [SEPOLIA_ID]: parseBlock(process.env.NEXT_PUBLIC_SEPOLIA_DEPLOY_BLOCK),
  [ANVIL_ID]: 0n,
};

export function isSupportedChain(chainId?: number): boolean {
  return chainId !== undefined && SUPPORTED_CHAIN_IDS.includes(chainId);
}

// Address for the given chain, or undefined if it is unset / the zero address.
export function getContractAddress(chainId?: number): `0x${string}` | undefined {
  if (!isSupportedChain(chainId)) return undefined;
  const address = CONTRACT_ADDRESSES[chainId as number];
  return address && address !== ZERO_ADDRESS ? address : undefined;
}

export function getChainName(chainId?: number): string {
  return (chainId !== undefined && CHAIN_NAMES[chainId]) || "Unknown network";
}
