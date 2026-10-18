# Multisig migration rehearsal scripts

| Script | Purpose | Dependencies |
|---|---|---|
| `squads-create.mjs` | Create a Squads 3-of-5 multisig (devnet/mainnet/local) | `@sqds/multisig` `@solana/web3.js` |
| `rehearsal-admin-migration.mjs` | Rehearse the program migration: propose_admin → time lock → accept_admin | `@solana/web3.js` `@solana/spl-token` |
| `devnet-governance-test.mjs` | Real devnet governance vote test: create test multisig → propose transfer → 3 votes → multisig execute | `@sqds/multisig` `@solana/web3.js` |
| `run.sh` | Orchestrator: local validator + deploy test-build programs + run the migration rehearsal | Solana/Anchor toolchain |

## Local rehearsal (verified)

```bash
bash scripts/multisig-rehearsal/run.sh
# Expected output: 🎉 Rehearsal passed: admin migrated to the (simulated) multisig / RESULT=PASS
```

## Real devnet governance vote test (verified PASS, 2026-08-08)

```bash
RPC=https://api.devnet.solana.com node scripts/multisig-rehearsal/devnet-governance-test.mjs
# Expected output: 🎉 Governance test passed: 3-of-5 proposal → vote → multisig execute transfer / GOV_TEST_RESULT=PASS
```
- Notes: each run creates a **brand-new test multisig** (independent createKey plus 5 temporary members, not project members),
  the vault transfers 0.001 SOL back to the payer, and the full path runs:
  `vaultTransactionCreate → proposalCreate(isDraft=false) → approve×3 → vaultTransactionExecute`.
- Squads V4 rules: a new multisig has `transaction_index=0`, so the first vault transaction uses index 1 (the on-chain `+1` rule);
  the `@sqds 2.1.4` parser reading 0 for the `transaction_index` offset is a known issue — the on-chain value is authoritative.
- Stability fix (2026-08-08): `confirmTransaction` completes before moving to the next step (devnet confirmation latency used to
  cause state races); with `isDraft=false` the proposal goes Active directly, so `proposalActivate` is unnecessary.
- The payer needs devnet SOL (each run costs about 0.05-0.1 SOL: 5 member transfers plus multisig/proposal/transaction rent).

## H-1 positive-path rehearsal (local, real Squads v4, verified PASS, 2026-08-09)

```bash
bash scripts/multisig-rehearsal/run.sh
# Expected output: ✅ All rehearsals passed (admin migration + H-1 positive path)
# Positive path: a real Squads VaultTransaction wraps the program admin instruction → 3/5 approvals → execution succeeds
```
- Notes: `run.sh` uses `solana-test-validator --clone` to pull the **real Squads v4 program**
  (program + ProgramData + ProgramConfig, from devnet), creates a real 3-of-5 multisig,
  then configures the program `multisig` and verifies that a single signature is rejected (MultisigEnforced)
  while the multisig VaultTransaction executes successfully.
- This is the "real VaultTransaction positive-path test" required by the audit (not a fakeMultisig, not negative-only).
- Devnet version: `RPC=<devnet> node devnet-multisig-admin-test.mjs` (requires the programs to be deployed and multisig configured).

## Creating a real multisig (devnet/mainnet, requires SOL)

```bash
# @sqds/multisig is a project devDependency (2.1.4); the payer needs SOL and must not be a Program ID account
RPC=https://api.devnet.solana.com PAYER_KP=~/.config/solana/id.json \
  node scripts/multisig-rehearsal/squads-create.mjs
# Custom members/threshold:
#   MEMBERS="<a>,<b>,<c>,<d>,<e>" THRESHOLD=3 RPC=<rpc> PAYER_KP=<kp> \
#     node scripts/multisig-rehearsal/squads-create.mjs
```
> The devnet free tier rate-limits `requestAirdrop` heavily (429) and the faucet occasionally runs dry globally; if the airdrop fails, transfer a small amount of SOL to the payer or use an already funded wallet.
> The new Squads V4 program (`SQDS4ep65…`) requires `treasury == ProgramConfig.treasury`; the script reads it automatically, no manual input needed.

## Rehearsal record (2026-08-08, devnet)

- 3-of-5 multisig created and verified on-chain: `MULTISIG_PDA=2NJfQrv4egYZzbmuHJNjAHyitM9TUMD9m5aFNJP3hZD5` (program `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`, timeLock=0)
- Members: DKjZeYsB… / F4WD7tD8… / SidAeEGs… / 2y5tHWpV… / Cw8hnS6t…
- Creating wallet (createKey/payer): `3xrRyw1xnGjaEYmCdFTARt8xVeKcZPUmarJRTwyJ4k8t` (devnet, rehearsal only)
- Mainnet multisig: created on launch day by the cold key holders via app.squads.so or the same script (mainnet RPC + funded mainnet wallet); the PDA differs because the createKey differs

## Go-live execution

See `docs/GO-LIVE-MULTISIG-RUNBOOK.md` (full runbook).
