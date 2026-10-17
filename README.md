# Partner

A trustless on-chain rotating savings circle (ROSCA / chit fund / committee) built for a
hackathon MVP, using **native ETH** only.

N members each pay `contribution` wei every round. In round `r`, the member who owns slot
`r` receives the whole pot. Each member picks a payout slot when joining and locks ETH
collateral sized to the contributions they will still owe *after* they have received the pot:

```
collateral(slot) = contribution * max(1, maxMembers - 1 - slot)
```

Collateral is refunded when the circle completes, minus anything slashed to cover missed
payments. Reputation (`completedCircles` / `totalDefaults`) is tracked per address.

## Deployed contract (Sepolia)

- Address: `0x40fb003cd41e79e4bbc8fb1bb1d84db0459294b2`
- Deploy block: `11933764`

These are public values, safe to commit.

## Layout

- `src/Partner.sol` — the single contract that manages every circle.
- `test/Partner.t.sol` — Foundry tests (collateral math, happy path, defaults, access control).
- `script/Deploy.s.sol` — deployment script.

## Build & test

```bash
forge build
forge test -vv
```

## Deploy to Sepolia

Copy the env template and fill in your own values (never commit `.env`):

```bash
cp .env.example .env
```

Then broadcast with your RPC URL and private key from the environment:

```bash
forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC_URL --private-key $PRIVATE_KEY --broadcast
```

Testnet only. Do not use real funds.

## Known limitations (MVP)

- `closeRound` sends ETH with a raw call. If a recipient is a contract that rejects ETH,
  the round cannot be closed. A pull-payment `withdraw()` is the roadmap fix.
- If a member defaults before their own payout they may exhaust their collateral early, and
  a later pot can be short by the uncovered amount.
