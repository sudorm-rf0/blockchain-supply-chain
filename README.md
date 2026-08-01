# Blockchain Supply Chain Monorepo

Solana/Anchor + NestJS + Next.js monorepo managed with pnpm workspaces and
Turbo.

## Packages

- `packages/contracts`: Anchor 0.30.1 Solana program (devnet + localnet).
- `packages/backend`: NestJS 10 API with `@solana/web3.js`, Prisma, BullMQ.
- `packages/frontend`: Next.js 14 App Router app with wallet adapter and
  Tailwind CSS.

## Quick start

```bash
./init-monorepo.sh --infra
pnpm --filter backend run prisma:generate
pnpm dev
```

`./init-monorepo.sh` generates `.env` files, creates the Solana program keypair
under `packages/contracts/target/deploy/`, patches the program ID into
`Anchor.toml` and `lib.rs`, then runs `pnpm install`. Pass `--build` to also
run Turbo and Anchor builds.
