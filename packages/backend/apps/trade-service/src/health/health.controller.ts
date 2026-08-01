import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";

@ApiTags("health")
@Controller("health")
export class HealthController {
  @Get()
  @ApiOperation({ summary: "服务健康检查" })
  @ApiOkResponse({
    schema: {
      type: "object",
      properties: {
        status: { type: "string", example: "ok" },
        service: { type: "string", example: "trade-service" },
        timestamp: { type: "string" },
      },
    },
  })
  getHealth() {
    return {
      status: "ok",
      service: "trade-service",
      timestamp: new Date().toISOString(),
    };
  }
}
