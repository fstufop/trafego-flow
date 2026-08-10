import { Test, TestingModule } from '@nestjs/testing';
import { AdsetAlertSchedulerService } from './adset-alert-scheduler.service.js';
import { AdsetAlertsService } from './adset-alerts.service.js';

const mockAdsetAlertsService = { triggerAll: jest.fn() };

describe('AdsetAlertSchedulerService', () => {
  let service: AdsetAlertSchedulerService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdsetAlertSchedulerService,
        { provide: AdsetAlertsService, useValue: mockAdsetAlertsService },
      ],
    }).compile();
    service = module.get<AdsetAlertSchedulerService>(
      AdsetAlertSchedulerService,
    );
  });

  describe('handleDailyCron', () => {
    it('calls triggerAll after the delay', async () => {
      jest.useFakeTimers();
      mockAdsetAlertsService.triggerAll.mockResolvedValueOnce(undefined);

      const cronPromise = service.handleDailyCron();
      jest.runAllTimers();
      await cronPromise;

      expect(mockAdsetAlertsService.triggerAll).toHaveBeenCalledTimes(1);
      jest.useRealTimers();
    });
  });
});
