import { Injectable } from "@nestjs/common";
import { PublicKey } from "@solana/web3.js";
import { PrismaService } from "../prisma/prisma.service";
import { getConnection } from "../supply-chain/solana/tx-builder";

const DEVNET_TRADE_ID = "9c8eND94LxNZgDbhvApGsRKojHyxhgEVUBSUHU9tRVU3";
const DEVNET_SUPPLY_ID = "Dcxixk89HPaC6yHKk1rP5HGMFgBMcRrYku6ze951C6Lk";
const BPF_LOADER_UPGRADEABLE = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);

function programIdOf(envKey: string, fallback: string): string {
  return process.env[envKey] ?? fallback;
}

async function readUpgradeAuthority(programId: string): Promise<{
  authority: string | null;
  programData: string | null;
  note?: string;
}> {
  try {
    const connection = getConnection();
    const pid = new PublicKey(programId);
    const [programData] = await PublicKey.findProgramAddress(
      [pid.toBuffer()],
      BPF_LOADER_UPGRADEABLE,
    );
    const info = await connection.getAccountInfo(programData, "confirmed");
    if (!info) {
      return { authority: null, programData: programData.toBase58(), note: "ProgramData 不存在（程序未部署）" };
    }
    const tag = info.data[8];
    const authority =
      tag === 0 ? null : new PublicKey(info.data.subarray(9, 41)).toBase58();
    return { authority, programData: programData.toBase58() };
  } catch (error) {
    return {
      authority: null,
      programData: null,
      note: `链上读取失败：${String(error).slice(0, 160)}`,
    };
  }
}

@Injectable()
export class OnchainGovernanceService {
  constructor(private readonly prisma: PrismaService) {}

  async status() {
    const tradeId = programIdOf(
      "TRADE_FINANCE_PROGRAM_ID",
      DEVNET_TRADE_ID,
    );
    const supplyId = programIdOf(
      "SUPPLY_CHAIN_PROGRAM_ID",
      DEVNET_SUPPLY_ID,
    );

    const [tradeUa, supplyUa, latestSnapshot] = await Promise.all([
      readUpgradeAuthority(tradeId),
      readUpgradeAuthority(supplyId),
      this.prisma.poolSnapshot.findFirst({
        orderBy: { capturedAt: "desc" },
      }),
    ]);

    const rpc = process.env.SOLANA_RPC_URL ?? "unset";
    const cluster = rpc.includes("mainnet")
      ? "mainnet"
      : rpc.includes("devnet")
        ? "devnet"
        : rpc.includes("localhost") || rpc.includes("127.0.0.1")
          ? "local"
          : "unknown";

    return {
      network: {
        rpc,
        cluster,
        // 评估 M-05：主网部署前禁止 devnet 占位 ID
        devnetPlaceholder: {
          tradeFinance: tradeId === DEVNET_TRADE_ID,
          supplyChain: supplyId === DEVNET_SUPPLY_ID,
        },
      },
      programs: {
        tradeFinance: {
          programId: tradeId,
          devnetPlaceholder: tradeId === DEVNET_TRADE_ID,
          upgradeAuthority: tradeUa,
        },
        supplyChain: {
          programId: supplyId,
          devnetPlaceholder: supplyId === DEVNET_SUPPLY_ID,
          upgradeAuthority: supplyUa,
        },
      },
      poolState: latestSnapshot
        ? {
            poolAddress: latestSnapshot.poolAddress,
            nav: latestSnapshot.nav.toString(),
            utilization: latestSnapshot.utilization.toString(),
            paused: latestSnapshot.paused,
            pendingAdmin: latestSnapshot.pendingAdmin,
            pendingAdminDelaySecs: latestSnapshot.pendingAdminDelaySecs.toString(),
            feeApyBps: latestSnapshot.feeApyBps.toString(),
            lpShareBps: latestSnapshot.lpShareBps.toString(),
            platformShareBps: latestSnapshot.platformShareBps.toString(),
            rebateShareBps: latestSnapshot.rebateShareBps.toString(),
            capturedAt: latestSnapshot.capturedAt.toISOString(),
          }
        : null,
      registry: await this.readRegistry(),
      deployment: {
        testDeployer: process.env.TEST_DEPLOYER ?? null,
        deployWallet: process.env.DEPLOY_WALLET ?? null,
        // 审计 N-03/H-1：主网 admin 必须指向 Squads ≥3/5 多签
        multisigAdmin: process.env.MULTISIG_ADMIN ?? null,
        multisigConfigured: Boolean(process.env.MULTISIG_ADMIN),
      },
    };
  }

  private async readRegistry(): Promise<{
    initialized: boolean;
    registry: string | null;
    admin: string | null;
    note?: string;
  }> {
    try {
      const { deriveRegistryPda, getProgramId } = await import(
        "../supply-chain/solana/tx-builder"
      );
      const registry = deriveRegistryPda(getProgramId());
      const info = await getConnection().getAccountInfo(registry, "confirmed");
      if (!info) {
        return { initialized: false, registry: registry.toBase58(), admin: null };
      }
      const admin = new PublicKey(info.data.subarray(8, 40)).toBase58();
      return { initialized: true, registry: registry.toBase58(), admin };
    } catch (error) {
      return {
        initialized: false,
        registry: null,
        admin: null,
        note: `链上读取失败：${String(error).slice(0, 160)}`,
      };
    }
  }
}
