import { BACKEND_URL } from "./env";
import { request } from "./http";

export interface GovernanceStatus {
  network: {
    rpc: string;
    cluster: string;
    devnetPlaceholder: { tradeFinance: boolean; supplyChain: boolean };
  };
  programs: {
    tradeFinance: { programId: string; devnetPlaceholder: boolean; upgradeAuthority: { authority: string | null; programData: string | null; note?: string } };
    supplyChain: { programId: string; devnetPlaceholder: boolean; upgradeAuthority: { authority: string | null; programData: string | null; note?: string } };
  };
  poolState: {
    poolAddress: string;
    nav: string;
    utilization: string;
    paused: boolean;
    pendingAdmin: string | null;
    pendingAdminDelaySecs: string;
    feeApyBps: string;
    lpShareBps: string;
    platformShareBps: string;
    rebateShareBps: string;
    capturedAt: string;
  } | null;
  registry: { initialized: boolean; registry: string | null; admin: string | null; note?: string };
  deployment: {
    testDeployer: string | null;
    deployWallet: string | null;
    multisigAdmin: string | null;
    multisigConfigured: boolean;
  };
}

export async function fetchGovernanceStatus(): Promise<GovernanceStatus> {
  return request(`${BACKEND_URL}/api/admin/onchain-governance`);
}
