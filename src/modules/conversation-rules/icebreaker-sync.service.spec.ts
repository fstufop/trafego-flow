import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { IcebreakerSyncService } from './icebreaker-sync.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { InstagramGraphService } from '../webhook/instagram/instagram-graph.service.js';
import { MetaPlatform } from '../integrations/entities/integration.entity.js';

const mockIntegrationsService = { findAll: jest.fn() };
const mockGraph = { setIceBreakers: jest.fn() };

describe('IcebreakerSyncService', () => {
  let service: IcebreakerSyncService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IcebreakerSyncService,
        { provide: IntegrationsService, useValue: mockIntegrationsService },
        { provide: InstagramGraphService, useValue: mockGraph },
      ],
    }).compile();
    service = module.get<IcebreakerSyncService>(IcebreakerSyncService);
  });

  it('should call setIceBreakers with the Instagram pageId and mapped questions', async () => {
    mockIntegrationsService.findAll.mockResolvedValue([
      { platform: MetaPlatform.WHATSAPP, pageId: 'WA1' },
      { platform: MetaPlatform.INSTAGRAM, pageId: 'IG1' },
    ]);
    mockGraph.setIceBreakers.mockResolvedValue(undefined);

    await service.sync('client-1', [{ icebreakerQuestion: 'Quero o grupo', triggerValue: 'PAYLOAD_1' }]);

    expect(mockGraph.setIceBreakers).toHaveBeenCalledWith('IG1', [
      { question: 'Quero o grupo', payload: 'PAYLOAD_1' },
    ]);
  });

  it('should throw BadRequestException when there is no active Instagram integration', async () => {
    mockIntegrationsService.findAll.mockResolvedValue([
      { platform: MetaPlatform.WHATSAPP, pageId: 'WA1' },
    ]);
    await expect(service.sync('client-1', [])).rejects.toThrow(BadRequestException);
    expect(mockGraph.setIceBreakers).not.toHaveBeenCalled();
  });

  it('should throw BadRequestException when the client has no integrations at all', async () => {
    mockIntegrationsService.findAll.mockResolvedValue([]);
    await expect(service.sync('client-1', [])).rejects.toThrow(BadRequestException);
  });

  it('should propagate the error from setIceBreakers without swallowing it', async () => {
    mockIntegrationsService.findAll.mockResolvedValue([{ platform: MetaPlatform.INSTAGRAM, pageId: 'IG1' }]);
    const graphError = new Error('Graph API rejected the payload');
    mockGraph.setIceBreakers.mockRejectedValue(graphError);
    await expect(service.sync('client-1', [])).rejects.toBe(graphError);
  });
});
