import { IsISO8601, IsOptional, IsUUID } from 'class-validator';

export class TriggerDispatchDto {
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @IsISO8601()
  weekStartDate?: string;
}
