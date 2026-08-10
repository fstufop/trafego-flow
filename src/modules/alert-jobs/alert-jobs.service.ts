import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AlertJobEntity } from './entities/alert-job.entity.js';
import { AlertJobStatus } from './enums/alert-job-status.enum.js';
import { AlertJobType } from './enums/alert-job-type.enum.js';
import { CreateAlertJobDto } from './dto/create-alert-job.dto.js';
import { UpdateAlertJobDto } from './dto/update-alert-job.dto.js';
import { IAlertJobsService } from './interfaces/alert-jobs-service.interface.js';

@Injectable()
export class AlertJobsService implements IAlertJobsService {
  constructor(
    @InjectRepository(AlertJobEntity)
    private readonly repo: Repository<AlertJobEntity>,
  ) {}

  findAll(filters?: { status?: AlertJobStatus; type?: AlertJobType }): Promise<AlertJobEntity[]> {
    return this.repo.find({
      where: {
        ...(filters?.status !== undefined && { status: filters.status }),
        ...(filters?.type !== undefined && { type: filters.type }),
      },
      order: { createdAt: 'DESC' },
    });
  }

  findActive(): Promise<AlertJobEntity[]> {
    return this.repo.find({ where: { status: AlertJobStatus.ACTIVE } });
  }

  create(dto: CreateAlertJobDto): Promise<AlertJobEntity> {
    return this.repo.save(
      this.repo.create({
        type: dto.type,
        status: dto.status ?? AlertJobStatus.ACTIVE,
        clientId: dto.clientId ?? null,
        fields: dto.fields ?? ['roas', 'last_updated'],
      }),
    );
  }

  async update(id: string, dto: UpdateAlertJobDto): Promise<AlertJobEntity> {
    const job = await this.repo.findOne({ where: { id } });
    if (!job) throw new NotFoundException(`AlertJob ${id} not found`);
    if (dto.status !== undefined) job.status = dto.status;
    if (dto.fields !== undefined) job.fields = dto.fields;
    return this.repo.save(job);
  }
}
