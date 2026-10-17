# Partner

**A trustless savings circle (chit fund / committee / ROSCA) on Ethereum, with position-based collateral.**

Built solo for the **SPPU x EFDEVCON Hackathon**. Testnet only — do not use real funds.

## Deployed contract (Sepolia)

- Address: [`0x40fb003cd41e79e4bbc8fb1bb1d84db0459294b2`](https://sepolia.etherscan.io/address/0x40fb003cd41e79e4bbc8fb1bb1d84db0459294b2)
- Deploy block: `11933764`
- Explorer: https://sepolia.etherscan.io/address/0x40fb003cd41e79e4bbc8fb1bb1d84db0459294b2

## The problem

Informal savings committees ("chit funds", "committees", ROSCAs) run entirely on trust. The
organizer can vanish with the pool, and a member can take their payout early and then stop
contributing. There is no enforcement and no portable reputation.

## The solution

Partner puts the whole circle on-chain with collateral that makes cheating unprofitable.

1. **Create a circle** — set the contribution, number of members `N` and round duration.
2. **Pick a payout slot and lock collateral** — the slot decides which round you receive the pot.
   Your collateral is:

   ```
   collateral(slot) = contribution * max(1, N - 1 - slot)
   ```

   This covers exactly the contributions an early recipient would still owe *after* being paid.
   Slot 0 (paid first) locks the most; the last slot only locks the minimum `1x`.
3. **Contribute every round** — in round `r` every member pays `contribution`.
4. **Receive the pot on your turn** — the member who owns slot `r` is paid the whole pot.
5. **Get leftover collateral back** — when the circle completes, collateral is refunded minus
   anything slashed to cover a missed payment.

Missed payments are covered from the defaulter's collateral and recorded in an **on-chain score**:
completed circles versus total defaults, readable by anyone.

## Architecture

```
   Browser (Next.js + wagmi + viem, MetaMask)
                 |
                 |  read/write calls
                 v
        Partner.sol on Sepolia  (native ETH)
                 |
                 |  events (Joined, Contributed, RoundClosed, Defaulted, CircleCompleted)
                 v
   Frontend reads events + view functions to render state
```

- **No backend.** Every circle lives in one contract; the UI is a thin client.
- **Native ETH only** — one transaction per action (join, contribute, close round).

## Tech stack

- **Contracts:** Solidity, Foundry (forge) for build/test/deploy.
- **Frontend:** Next.js (App Router), TypeScript, wagmi + viem, Tailwind CSS, MetaMask.

## Project structure

```
src/       Partner.sol — the single contract managing every circle
test/      Partner.t.sol — Foundry tests
script/    Deploy.s.sol — deployment script
web/       Next.js frontend (create, circle, profile pages)
```

## Run locally

Contracts:

```bash
forge build
forge test
```

Frontend:

```bash
cd web
cp .env.example .env.local
npm install
npm run dev
```

Environment variables (in `web/.env.local`):

- `NEXT_PUBLIC_PARTNER_ADDRESS_SEPOLIA` — deployed contract address
- `NEXT_PUBLIC_DEPLOY_BLOCK` — block the contract was deployed at (log look-back start)
- `NEXT_PUBLIC_DEFAULT_CHAIN` — `sepolia` or `anvil`

Local development with **Anvil**:

```bash
anvil
# in another shell, from the repo root:
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
# then in web/.env.local:
#   NEXT_PUBLIC_PARTNER_ADDRESS_ANVIL=<deployed address>
#   NEXT_PUBLIC_DEFAULT_CHAIN=anvil
```

## Tests

```bash
forge test
```

**15 tests pass**, covering collateral math, the happy path, access control and default handling.
The key test is `test_EarlyRecipientVanishes_CollateralCovers`: the early recipient takes the pot
and then disappears, and their collateral still covers every later round.

## Pages

The frontend (`web/app`) has four routes:

- `/` — list circles, create entry point.
- `/create` — create a new circle.
- `/circle/[id]` — circle detail: slots, contribute, close round, live event history.
- `/profile/[address]` — reputation (completed circles / defaults) and the address's circles.

## Limitations and roadmap

Known limitations:

- Early slots require significant upfront capital (collateral scales with position).
- A member who defaults *before* their own payout can exhaust their collateral early, leaving a
  later pot short by the uncovered amount (`test_PreTurnDefaulter_ShortPot_KnownLimitation`).
- `closeRound` uses a raw ETH call; if a recipient is a contract that rejects ETH, the round cannot
  be closed. A pull-payment `withdraw()` is the fix.
- Native ETH only.

Roadmap:

- Stablecoins alongside native ETH.
- Progressive collateral release as rounds pass.
- Yield on locked collateral.
- Randomized or bid-based slot assignment.
- Sybil resistance.
- Independent audit and regulatory review (India Chit Funds Act, 1982).

Other on-chain ROSCA projects exist; Partner's focus is a minimal, **oracle-free, KYC-free** core
with correct collateral math.

## Disclaimer

Hackathon prototype. **Unaudited.** Deployed to a testnet only — do not use real funds.
