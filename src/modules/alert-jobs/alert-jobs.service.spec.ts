import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { AlertJobsService } from './alert-jobs.service.js';
import { AlertJobEntity } from './entities/alert-job.entity.js';
import { AlertJobStatus } from './enums/alert-job-status.enum.js';
import { AlertJobType } from './enums/alert-job-type.enum.js';

const mockRepo = {
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};

describe('AlertJobsService', () => {
  let service: AlertJobsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertJobsService,
        { provide: getRepositoryToken(AlertJobEntity), useValue: mockRepo },
      ],
    }).compile();
    service = module.get<AlertJobsService>(AlertJobsService);
  });

  describe('findActive', () => {
    it('queries only ACTIVE jobs', async () => {
      mockRepo.find.mockResolvedValueOnce([]);
      await service.findActive();
      expect(mockRepo.find).toHaveBeenCalledWith({ where: { status: AlertJobStatus.ACTIVE } });
    });
  });

  describe('findAll', () => {
    it('applies status filter when provided', async () => {
      mockRepo.find.mockResolvedValueOnce([]);
      await service.findAll({ status: AlertJobStatus.INACTIVE });
      expect(mockRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: AlertJobStatus.INACTIVE }) }),
      );
    });

    it('applies type filter when provided', async () => {
      mockRepo.find.mockResolvedValueOnce([]);
      await service.findAll({ type: AlertJobType.ADSET_INSIGHTS });
      expect(mockRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ type: AlertJobType.ADSET_INSIGHTS }) }),
      );
    });
  });

  describe('create', () => {
    it('defaults status to ACTIVE and fields to roas+last_updated when not provided', async () => {
      const created = { id: 'uuid-1', type: AlertJobType.ADSET_INSIGHTS, status: AlertJobStatus.ACTIVE, clientId: null, fields: ['roas', 'last_updated'] };
      mockRepo.create.mockReturnValueOnce(created);
      mockRepo.save.mockResolvedValueOnce(created);

      const result = await service.create({ type: AlertJobType.ADSET_INSIGHTS });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: AlertJobStatus.ACTIVE, fields: ['roas', 'last_updated'], clientId: null }),
      );
      expect(result).toEqual(created);
    });
  });

  describe('update', () => {
    it('throws NotFoundException when job does not exist', async () => {
      mockRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.update('nonexistent', { status: AlertJobStatus.INACTIVE })).rejects.toThrow(NotFoundException);
    });

    it('updates status without touching fields', async () => {
      const job = { id: 'uuid-1', status: AlertJobStatus.ACTIVE, fields: ['roas'] };
      mockRepo.findOne.mockResolvedValueOnce(job);
      mockRepo.save.mockResolvedValueOnce({ ...job, status: AlertJobStatus.INACTIVE });

      const result = await service.update('uuid-1', { status: AlertJobStatus.INACTIVE });

      expect(result.status).toBe(AlertJobStatus.INACTIVE);
      expect(result.fields).toEqual(['roas']);
    });

    it('replaces fields array entirely when provided', async () => {
      const job = { id: 'uuid-1', status: AlertJobStatus.ACTIVE, fields: ['roas'] };
      mockRepo.findOne.mockResolvedValueOnce(job);
      mockRepo.save.mockResolvedValueOnce({ ...job, fields: ['roas', 'ctr'] });

      const result = await service.update('uuid-1', { fields: ['roas', 'ctr'] });

      expect(result.fields).toEqual(['roas', 'ctr']);
    });
  });
});
