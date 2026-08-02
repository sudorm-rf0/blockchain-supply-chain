import { Controller, Get } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";

@SkipThrottle()
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
        service: { type: "string", example: "indexer-service" },
        timestamp: { type: "string" },
      },
    },
  })
  getHealth() {
    return {
      status: "ok",
      service: "indexer-service",
      timestamp: new Date().toISOString(),
    };
  }
}
