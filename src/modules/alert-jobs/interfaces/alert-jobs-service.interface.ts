import { AlertJobEntity } from '../entities/alert-job.entity.js';
import { AlertJobStatus } from '../enums/alert-job-status.enum.js';
import { AlertJobType } from '../enums/alert-job-type.enum.js';
import { CreateAlertJobDto } from '../dto/create-alert-job.dto.js';
import { UpdateAlertJobDto } from '../dto/update-alert-job.dto.js';

export interface IAlertJobsService {
  findAll(filters?: { status?: AlertJobStatus; type?: AlertJobType }): Promise<AlertJobEntity[]>;
  findActive(): Promise<AlertJobEntity[]>;
  create(dto: CreateAlertJobDto): Promise<AlertJobEntity>;
  update(id: string, dto: UpdateAlertJobDto): Promise<AlertJobEntity>;
}
