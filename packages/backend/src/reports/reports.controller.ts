import {
  Controller,
  Get,
  Header,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { AdminGuard, AuthGuard } from "@supply-chain/common";
import type { Response } from "express";
import { ReportsService } from "./reports.service";

@UseGuards(AuthGuard, AdminGuard)
@Controller("api/admin/reports")
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get("orders")
  orders(@Query("from") from?: string, @Query("to") to?: string, @Query("status") status?: string) {
    return this.reports.orders(from, to, status);
  }

  @Get("financing")
  financing(@Query("from") from?: string, @Query("to") to?: string, @Query("status") status?: string) {
    return this.reports.financing(from, to, status);
  }

  @Get("audit")
  audit(@Query("from") from?: string, @Query("to") to?: string, @Query("action") action?: string) {
    return this.reports.audit(from, to, action);
  }

  @Get("orders/export")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="orders.csv"')
  async ordersExport(@Query("from") from?: string, @Query("to") to?: string, @Res() res?: Response) {
    res!.send("\uFEFF" + (await this.reports.ordersCsv(from, to)));
  }

  @Get("financing/export")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="financing.csv"')
  async financingExport(@Query("from") from?: string, @Query("to") to?: string, @Res() res?: Response) {
    res!.send("\uFEFF" + (await this.reports.financingCsv(from, to)));
  }

  @Get("audit/export")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="audit.csv"')
  async auditExport(@Query("from") from?: string, @Query("to") to?: string, @Res() res?: Response) {
    res!.send("\uFEFF" + (await this.reports.auditCsv(from, to)));
  }
}
