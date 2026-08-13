import { IsIn } from "class-validator";

export class ChangeRoleDto {
  @IsIn(["USER", "ADMIN", "SUPER_ADMIN"])
  role!: "USER" | "ADMIN" | "SUPER_ADMIN";
}
