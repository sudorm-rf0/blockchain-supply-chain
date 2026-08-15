import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AdminGuard, AuthGuard } from "@supply-chain/common";
import type { Request } from "express";
import { IntegrationsService } from "./integrations.service";

@UseGuards(AuthGuard, AdminGuard)
@Controller("api/admin/integrations")
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get("api-keys")
  listApiKeys(@Req() req?: Request) {
    return this.integrations.listApiKeys(req!.user!.sub);
  }

  @Post("api-keys")
  createApiKey(@Req() req?: Request, @Body() body?: { name?: string; role?: string }) {
    return this.integrations.createApiKey(req!.user!.sub, body ?? {});
  }

  @Delete("api-keys/:id")
  revokeApiKey(@Param("id") id: string, @Req() req?: Request) {
    return this.integrations.revokeApiKey(req!.user!.sub, id);
  }

  @Get("webhooks")
  listWebhooks(@Req() req?: Request) {
    return this.integrations.listWebhooks(req!.user!.sub);
  }

  @Post("webhooks")
  createWebhook(@Req() req?: Request, @Body() body?: { name?: string; url?: string; events?: string[]; active?: boolean }) {
    return this.integrations.createWebhook(req!.user!.sub, body ?? {});
  }

  @Patch("webhooks/:id")
  updateWebhook(@Param("id") id: string, @Req() req?: Request, @Body() body?: { name?: string; url?: string; events?: string[]; active?: boolean }) {
    return this.integrations.updateWebhook(req!.user!.sub, id, body ?? {});
  }

  @Delete("webhooks/:id")
  deleteWebhook(@Param("id") id: string, @Req() req?: Request) {
    return this.integrations.deleteWebhook(req!.user!.sub, id);
  }

  @Post("webhooks/:id/test")
  testWebhook(@Param("id") id: string, @Req() req?: Request) {
    return this.integrations.testWebhook(req!.user!.sub, id);
  }
}
