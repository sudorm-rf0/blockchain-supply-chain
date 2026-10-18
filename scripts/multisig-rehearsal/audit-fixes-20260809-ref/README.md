# Audit patch reference (audit-fixes-20260809)

- `h1-multisig-positive.test.ts`: positive-path test scaffold provided by the auditor (built on the legacy
  `@sqds/multisig` `lib/instructions` API). The project's `@sqds/multisig` 2.1.4 uses the rpc API, and the
  scenario is fully implemented and locally verified PASS by
  `scripts/multisig-rehearsal/h1-positive-path-local.mjs`
  (real Squads v4 via `--clone` + VaultTransaction wrapping the program admin instruction + 3/5 approvals + successful execution).
- `H-1-PATCHES.md`: auditor SEARCH→REPLACE hunks. All corresponding changes are already applied:
  - MULTISIG_ADMIN precheck hard-fail + on-chain multisig enforcement (scripts/precheck-mainnet-deploy.sh)
  - vault index: the project already uses the on-chain `multisig_vault_index` field (more thorough than the patch's SQUADS_VAULT_INDEX constant)
  - deployment-info honesty fix (scripts/build-audit-package.sh)
