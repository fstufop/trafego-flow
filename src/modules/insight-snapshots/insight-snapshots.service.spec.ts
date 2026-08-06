import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InsightSnapshotsService } from './insight-snapshots.service.js';
import { InsightSnapshotEntity } from './entities/insight-snapshot.entity.js';

const makeRepo = () => ({
  upsert: jest.fn().mockResolvedValue(undefined),
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
    it('calls repo.upsert with correct fields', async () => {
      const weekStart = new Date('2026-07-27');
      const snapshot = { spend: 100, reach: 500, impressions: 1000, clicks: 50, ctr: 5, cpm: 10, purchases: 0, addToCart: 0, pageViews: 0, contentViews: 0, checkoutInitiated: 0, messagesStarted: 0, liveViews: 0 };
      repo.findOne.mockResolvedValue({ id: 'uuid', adAccountId: 'act_1' });

      await service.saveSnapshot('act_1', 'client_1', weekStart, snapshot);

      expect(repo.upsert).toHaveBeenCalledWith(
        { adAccountId: 'act_1', clientId: 'client_1', weekStartDate: weekStart, snapshotJson: snapshot },
        { conflictPaths: ['adAccountId', 'weekStartDate'], skipUpdateIfNoValuesChanged: true },
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
