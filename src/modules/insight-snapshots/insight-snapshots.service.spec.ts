import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InsightSnapshotsService } from './insight-snapshots.service.js';
import { InsightSnapshotEntity } from './entities/insight-snapshot.entity.js';

const makeRepo = () => ({
  save: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn((v) => v),
});

describe('InsightSnapshotsService', () => {
  let service: InsightSnapshotsService;
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(async () => {
    repo = makeRepo();
    const module = await Test.createTestingModule({
      providers: [
        InsightSnapshotsService,
        { provide: getRepositoryToken(InsightSnapshotEntity), useValue: repo },
      ],
    }).compile();
    service = module.get(InsightSnapshotsService);
  });

  describe('saveSnapshot', () => {
    it('calls repo.save with correct fields', async () => {
      const weekStart = new Date('2026-07-27');
      const snapshot = { impressions: '100' } as any;
      repo.save.mockResolvedValue({ id: 'uuid', adAccountId: 'act_1' });

      await service.saveSnapshot('act_1', 'client_1', weekStart, snapshot);

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          adAccountId: 'act_1',
          clientId: 'client_1',
          weekStartDate: weekStart,
          snapshotJson: snapshot,
        }),
      );
    });
  });

  describe('findPreviousSnapshot', () => {
    it('queries for weekStartDate 7 days before', async () => {
      const weekStart = new Date('2026-07-27T00:00:00.000Z');
      const prevWeek = new Date('2026-07-20T00:00:00.000Z');
      repo.findOne.mockResolvedValue(null);

      await service.findPreviousSnapshot('act_1', weekStart);

      expect(repo.findOne).toHaveBeenCalledWith({
        where: { adAccountId: 'act_1', weekStartDate: prevWeek },
      });
    });

    it('returns null when no previous snapshot exists', async () => {
      repo.findOne.mockResolvedValue(null);
      const result = await service.findPreviousSnapshot('act_1', new Date('2026-07-27'));
      expect(result).toBeNull();
    });
  });
});
