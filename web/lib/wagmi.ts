// wagmi/viem client setup.
//
// IMPORTANT: only the `injected` connector is configured, so the app talks to
// MetaMask (or any browser wallet) and never needs a WalletConnect project id.
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { sepolia, anvil } from "wagmi/chains";
import { ANVIL_ID, ANVIL_RPC_URL, DEFAULT_CHAIN_ID, SEPOLIA_RPC_URL } from "./config";

// Build a fresh config. Called once from components/Providers.tsx.
export function getWagmiConfig() {
  // Order matters: the first chain is the default while the wallet is disconnected,
  // so honour NEXT_PUBLIC_DEFAULT_CHAIN here.
  const chains = DEFAULT_CHAIN_ID === ANVIL_ID ? ([anvil, sepolia] as const) : ([sepolia, anvil] as const);

  return createConfig({
    chains,
    connectors: [injected({ shimDisconnect: true })],
    transports: {
      [sepolia.id]: http(SEPOLIA_RPC_URL),
      [anvil.id]: http(ANVIL_RPC_URL),
    },
  });
}

export type AppWagmiConfig = ReturnType<typeof getWagmiConfig>;
