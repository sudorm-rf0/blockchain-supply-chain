import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthGuard, SuperAdminGuard } from "@supply-chain/common";
import { OnchainGovernanceService } from "./onchain-governance.service";

@UseGuards(AuthGuard, SuperAdminGuard)
@Controller("api/admin/onchain-governance")
export class OnchainGovernanceController {
  constructor(private readonly governance: OnchainGovernanceService) {}

  @Get()
  status() {
    return this.governance.status();
  }
}
