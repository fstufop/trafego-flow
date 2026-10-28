import { Test, TestingModule } from '@nestjs/testing';
import { HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { getDataSourceToken } from '@nestjs/typeorm';
import { HealthController } from './health.controller.js';
import { RedisConnectionStatusService } from './redis-connection-status.service.js';

type IndicatorFn = () => unknown;

describe('HealthController', () => {
  let controller: HealthController;
  let healthCheckService: {
    check: jest.Mock<unknown[], [IndicatorFn[]]>;
  };
  let redisStatus: { isConnected: jest.Mock };

  beforeEach(async () => {
    healthCheckService = {
      check: jest.fn((indicators: IndicatorFn[]) =>
        indicators.map((fn) => fn()),
      ),
    };
    redisStatus = { isConnected: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: healthCheckService },
        { provide: TypeOrmHealthIndicator, useValue: { pingCheck: jest.fn() } },
        { provide: getDataSourceToken(), useValue: {} },
        { provide: RedisConnectionStatusService, useValue: redisStatus },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('reports redis as up without touching Redis itself', () => {
    redisStatus.isConnected.mockReturnValue(true);

    void controller.check();
    const indicators = healthCheckService.check.mock.calls[0][0];
    const redisResult = indicators[1]();

    expect(redisResult).toEqual({ redis: { status: 'up' } });
    expect(redisStatus.isConnected).toHaveBeenCalled();
  });

  it('reports redis as down when the status service says so', () => {
    redisStatus.isConnected.mockReturnValue(false);

    void controller.check();
    const indicators = healthCheckService.check.mock.calls[0][0];
    const redisResult = indicators[1]();

    expect(redisResult).toEqual({ redis: { status: 'down' } });
  });
});
