import {
  Controller,
  Get,
  Header,
  Query,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { AdminGuard } from "../auth/admin.guard";
import { AuditService } from "./audit.service";

@Controller("api/admin/audit-logs")
@UseGuards(AuthGuard, AdminGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(
    @Query("page") page = "1",
    @Query("limit") limit = "20",
    @Query("action") action?: string,
    @Query("targetType") targetType?: string,
  ) {
    return this.audit.list({
      page: Math.max(1, Number(page) || 1),
      limit: Math.min(100, Math.max(1, Number(limit) || 20)),
      action,
      targetType,
    });
  }

  @Get("export")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header(
    "Content-Disposition",
    'attachment; filename="audit-logs.csv"',
  )
  exportCsv(
    @Query("action") action?: string,
    @Query("targetType") targetType?: string,
    @Query("limit") limit = "10000",
  ) {
    const stream = this.audit.exportCsv({
      action,
      targetType,
      limit: Math.min(100_000, Math.max(1, Number(limit) || 10_000)),
    });
    return new StreamableFile(stream);
  }
}
