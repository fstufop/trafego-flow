import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';
import { AlertJobStatus } from '../enums/alert-job-status.enum.js';

export class UpdateAlertJobDto {
  @IsEnum(AlertJobStatus)
  @IsOptional()
  status?: AlertJobStatus;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  fields?: string[];
}
