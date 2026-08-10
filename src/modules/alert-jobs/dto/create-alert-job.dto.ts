import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';
import { AlertJobType } from '../enums/alert-job-type.enum.js';
import { AlertJobStatus } from '../enums/alert-job-status.enum.js';

export class CreateAlertJobDto {
  @IsEnum(AlertJobType)
  type: AlertJobType;

  @IsEnum(AlertJobStatus)
  @IsOptional()
  status?: AlertJobStatus;

  @IsString()
  @IsOptional()
  clientId?: string | null;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  fields?: string[];
}
