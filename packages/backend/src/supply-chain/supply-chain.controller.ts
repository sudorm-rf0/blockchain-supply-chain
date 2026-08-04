import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { AdminGuard } from "../auth/admin.guard";
import { AuthGuard } from "../auth/auth.guard";
import { SupplyChainService } from "./supply-chain.service";
import type {
  InitRegistryConfirmDto,
  RegisterProductConfirmDto,
  RegisterProductDto,
  RevokeConfirmDto,
  SupplierConfirmDto,
  SupplierDto,
} from "./dto/supply-chain.dto";

@Controller("api/supply-chain")
@UseGuards(AuthGuard, AdminGuard)
export class SupplyChainController {
  constructor(private readonly service: SupplyChainService) {}

  @Get("registry")
  async registryStatus() {
    return this.service.registryStatus();
  }

  @Post("registry/init")
  async initRegistry(@Body() body: { adminWallet: string }) {
    return this.service.buildInitRegistry(body.adminWallet);
  }

  @Post("registry/init/confirm")
  async confirmInitRegistry(
    @Req() req: Request,
    @Body() body: InitRegistryConfirmDto,
  ) {
    return this.service.confirmInitRegistry(
      req.user!.sub,
      body.adminWallet,
      body.txSignature,
    );
  }

  @Get("suppliers")
  async suppliers() {
    return this.service.listSuppliers();
  }

  @Post("suppliers")
  async authorizeSupplier(@Body() body: SupplierDto) {
    return this.service.buildAuthorizeSupplier(
      body.adminWallet,
      body.supplier,
    );
  }

  @Post("suppliers/confirm")
  async confirmAuthorizeSupplier(
    @Req() req: Request,
    @Body() body: SupplierConfirmDto,
  ) {
    return this.service.confirmAuthorizeSupplier(
      req.user!.sub,
      body.supplier,
      body.txSignature,
    );
  }

  @Post("suppliers/:address/revoke")
  async revokeSupplier(
    @Body() body: { adminWallet: string },
    @Param("address") address: string,
  ) {
    return this.service.buildRevokeSupplier(body.adminWallet, address);
  }

  @Post("suppliers/:address/revoke/confirm")
  async confirmRevokeSupplier(
    @Req() req: Request,
    @Param("address") address: string,
    @Body() body: RevokeConfirmDto,
  ) {
    return this.service.confirmRevokeSupplier(
      req.user!.sub,
      address,
      body.txSignature,
    );
  }

  @Get("products")
  async products() {
    return this.service.listProducts();
  }

  @Post("products")
  async registerProduct(@Body() body: RegisterProductDto) {
    return this.service.buildRegisterProduct(
      body.adminWallet,
      body.sku,
      body.units,
    );
  }

  @Post("products/confirm")
  async confirmRegisterProduct(
    @Req() req: Request,
    @Body() body: RegisterProductConfirmDto,
  ) {
    return this.service.confirmRegisterProduct(
      req.user!.sub,
      body.adminWallet,
      body.sku,
      body.units,
      body.txSignature,
    );
  }
}
