import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException } from '@nestjs/common';
import { of } from 'rxjs';
import { ConversationRulesService } from './conversation-rules.service.js';
import { ConversationRuleEntity } from './entities/conversation-rule.entity.js';
import { RuleType } from './enums/rule-type.enum.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { AesCryptoService } from '../../common/crypto/aes.service.js';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

const mockRepo = {
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  softDelete: jest.fn(),
  findOneByOrFail: jest.fn(),
};

const mockIntegrationsService = {
  findByPageId: jest.fn(),
};

const mockCrypto = {
  decrypt: jest.fn().mockReturnValue('plain-token'),
};

const mockHttp = {
  get: jest.fn(),
};

const mockConfig = {
  get: jest.fn((key: string) => {
    if (key === 'meta.graphApiUrl') return 'https://graph.facebook.com';
    if (key === 'meta.graphApiVersion') return 'v21.0';
    return undefined;
  }),
};

describe('ConversationRulesService', () => {
  let service: ConversationRulesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationRulesService,
        { provide: getRepositoryToken(ConversationRuleEntity), useValue: mockRepo },
        { provide: IntegrationsService, useValue: mockIntegrationsService },
        { provide: AesCryptoService, useValue: mockCrypto },
        { provide: HttpService, useValue: mockHttp },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = module.get<ConversationRulesService>(ConversationRulesService);
  });

  describe('create', () => {
    it('should throw ConflictException when duplicate rule exists', async () => {
      mockRepo.findOne.mockResolvedValue({ id: 'existing' });
      await expect(
        service.create({ clientId: 'c1', type: RuleType.DEFAULT, reply: { text: 'hi' } } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('should create rule when no duplicate exists', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      const rule = { id: 'new', clientId: 'c1', type: RuleType.DEFAULT };
      mockRepo.create.mockReturnValue(rule);
      mockRepo.save.mockResolvedValue(rule);
      const result = await service.create({ clientId: 'c1', type: RuleType.DEFAULT, reply: { text: 'hi' } } as any);
      expect(result).toEqual(rule);
    });

    it('should set triggerValue to null for default type', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      mockRepo.create.mockReturnValue({});
      mockRepo.save.mockResolvedValue({});
      await service.create({ clientId: 'c1', type: RuleType.DEFAULT, triggerValue: 'ignored', reply: { text: 'hi' } } as any);
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ triggerValue: null }),
      );
    });
  });

  describe('findKeywordRule', () => {
    it('should return null when no keyword rules exist', async () => {
      mockRepo.find.mockResolvedValue([]);
      const result = await service.findKeywordRule('c1', 'hello world');
      expect(result).toBeNull();
    });

    it('should return rule when keyword is contained in text (case-insensitive)', async () => {
      const rule = { id: 'r1', triggerValue: 'quero', type: RuleType.KEYWORD_DM };
      mockRepo.find.mockResolvedValue([rule]);
      const result = await service.findKeywordRule('c1', 'Eu Quero comprar');
      expect(result).toEqual(rule);
    });

    it('should return the longest matching keyword rule', async () => {
      const short = { id: 'r1', triggerValue: 'quero', type: RuleType.KEYWORD_DM };
      const long = { id: 'r2', triggerValue: 'quero preco', type: RuleType.KEYWORD_DM };
      mockRepo.find.mockResolvedValue([short, long]);
      const result = await service.findKeywordRule('c1', 'quero preco agora');
      expect(result).toEqual(long);
    });

    it('should return null when keyword not contained in text', async () => {
      const rule = { id: 'r1', triggerValue: 'quero', type: RuleType.KEYWORD_DM };
      mockRepo.find.mockResolvedValue([rule]);
      const result = await service.findKeywordRule('c1', 'olá tudo bem');
      expect(result).toBeNull();
    });
  });

  describe('findDefaultRule', () => {
    it('should return null when no default rule exists', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      const result = await service.findDefaultRule('c1');
      expect(result).toBeNull();
    });

    it('should return the default rule', async () => {
      const rule = { id: 'r1', type: RuleType.DEFAULT };
      mockRepo.findOne.mockResolvedValue(rule);
      const result = await service.findDefaultRule('c1');
      expect(result).toEqual(rule);
    });
  });

  describe('findPostRule', () => {
    it('should return null when no rule for post', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      const result = await service.findPostRule('c1', 'post123');
      expect(result).toBeNull();
    });

    it('should return rule matching postId', async () => {
      const rule = { id: 'r1', triggerValue: 'post123', type: RuleType.POST_COMMENT };
      mockRepo.findOne.mockResolvedValue(rule);
      const result = await service.findPostRule('c1', 'post123');
      expect(result).toEqual(rule);
      expect(mockRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ triggerValue: 'post123' }) }),
      );
    });
  });

  describe('getRecentPosts', () => {
    it('should call Graph API and return posts array', async () => {
      mockIntegrationsService.findByPageId.mockResolvedValue({ accessToken: 'enc' });
      mockHttp.get.mockReturnValue(
        of({ data: { data: [{ id: '123', caption: 'Test', timestamp: '2026-09-01T00:00:00Z', permalink: 'https://www.instagram.com/p/ABC/' }] } }),
      );
      const result = await service.getRecentPosts('PAGE123');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('123');
      expect(mockHttp.get).toHaveBeenCalledWith(
        'https://graph.facebook.com/v21.0/me/media',
        expect.objectContaining({ params: expect.objectContaining({ access_token: 'plain-token' }) }),
      );
    });
  });
});
