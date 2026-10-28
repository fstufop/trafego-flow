import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter } from 'events';
import Redis from 'ioredis';
import { RedisConnectionStatusService } from './redis-connection-status.service.js';

type MockRedisClient = EventEmitter & { quit: jest.Mock };

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => {
    const client = new EventEmitter() as MockRedisClient;
    client.quit = jest.fn().mockResolvedValue(undefined);
    return client;
  });
});

describe('RedisConnectionStatusService', () => {
  let service: RedisConnectionStatusService;
  let client: MockRedisClient;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mockConfig = {
      get: jest.fn().mockReturnValue('redis://localhost:6379'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisConnectionStatusService,
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<RedisConnectionStatusService>(
      RedisConnectionStatusService,
    );
    const results = (Redis as unknown as jest.Mock).mock.results;
    client = results[results.length - 1].value as MockRedisClient;
  });

  it('is not connected before the client emits "ready"', () => {
    expect(service.isConnected()).toBe(false);
  });

  it('becomes connected once the client emits "ready"', () => {
    client.emit('ready');
    expect(service.isConnected()).toBe(true);
  });

  it('becomes disconnected again after an "error" event', () => {
    client.emit('ready');
    client.emit('error', new Error('connection lost'));
    expect(service.isConnected()).toBe(false);
  });

  it('becomes disconnected after a "close" event', () => {
    client.emit('ready');
    client.emit('close');
    expect(service.isConnected()).toBe(false);
  });

  it('quits the client on module destroy', async () => {
    await service.onModuleDestroy();
    expect(client.quit).toHaveBeenCalled();
  });
});
