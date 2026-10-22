import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { ConversationRulesService } from './conversation-rules.service.js';
import { ConversationRuleEntity } from './entities/conversation-rule.entity.js';
import { RuleType } from './enums/rule-type.enum.js';
import { IcebreakerSyncService } from './icebreaker-sync.service.js';
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
};

const mockIcebreakerSync = { sync: jest.fn() };

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
        {
          provide: getRepositoryToken(ConversationRuleEntity),
          useValue: mockRepo,
        },
        { provide: IntegrationsService, useValue: mockIntegrationsService },
        { provide: AesCryptoService, useValue: mockCrypto },
        { provide: HttpService, useValue: mockHttp },
        { provide: ConfigService, useValue: mockConfig },
        { provide: IcebreakerSyncService, useValue: mockIcebreakerSync },
      ],
    }).compile();
    service = module.get<ConversationRulesService>(ConversationRulesService);
  });

  describe('create', () => {
    it('should throw ConflictException when duplicate rule exists', async () => {
      mockRepo.findOne.mockResolvedValue({ id: 'existing' });
      await expect(
        service.create({
          clientId: 'c1',
          type: RuleType.DEFAULT,
          reply: { text: 'hi' },
        } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('should create rule when no duplicate exists', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      const rule = { id: 'new', clientId: 'c1', type: RuleType.DEFAULT };
      mockRepo.create.mockReturnValue(rule);
      mockRepo.save.mockResolvedValue(rule);
      const result = await service.create({
        clientId: 'c1',
        type: RuleType.DEFAULT,
        reply: { text: 'hi' },
      });
      expect(result).toEqual(rule);
    });

    it('should set triggerValue to null for default type', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      mockRepo.create.mockReturnValue({});
      mockRepo.save.mockResolvedValue({});
      await service.create({
        clientId: 'c1',
        type: RuleType.DEFAULT,
        triggerValue: 'ignored',
        reply: { text: 'hi' },
      });
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ triggerValue: null }),
      );
    });

    it('should throw BadRequestException when reply has no fields', async () => {
      await expect(
        service.create({
          clientId: 'c1',
          type: RuleType.DEFAULT,
          reply: {},
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should persist commentKeyword and publicReply for post_comment rules', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      mockRepo.create.mockReturnValue({});
      mockRepo.save.mockResolvedValue({});
      await service.create({
        clientId: 'c1',
        type: RuleType.POST_COMMENT,
        triggerValue: 'post123',
        reply: { text: 'Te chamei no privado!' },
        commentKeyword: 'quero',
        publicReply: 'Te enviamos na DM!',
      });
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          commentKeyword: 'quero',
          publicReply: 'Te enviamos na DM!',
        }),
      );
    });

    it('should set commentKeyword and publicReply to null for non post_comment rules', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      mockRepo.create.mockReturnValue({});
      mockRepo.save.mockResolvedValue({});
      await service.create({
        clientId: 'c1',
        type: RuleType.KEYWORD_DM,
        triggerValue: 'oi',
        reply: { text: 'Olá!' },
      });
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ commentKeyword: null, publicReply: null }),
      );
    });
  });

  describe('create — icebreaker-specific behavior', () => {
    it('should generate the triggerValue and ignore any value sent by the client', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      mockRepo.find.mockResolvedValue([]);
      mockRepo.create.mockReturnValue({});
      mockRepo.save.mockResolvedValue({});
      mockIcebreakerSync.sync.mockResolvedValue(undefined);
      await service.create({
        clientId: 'c1',
        type: RuleType.ICEBREAKER,
        triggerValue: 'client-supplied',
        icebreakerQuestion: 'Quero o grupo',
        reply: { text: 'Oi!' },
      });
      const created = mockRepo.create.mock.calls[0][0];
      expect(created.triggerValue).not.toBe('client-supplied');
      expect(typeof created.triggerValue).toBe('string');
      expect(created.triggerValue.length).toBeGreaterThan(0);
    });

    it('should persist icebreakerQuestion for icebreaker rules and null it out for other types', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      mockRepo.find.mockResolvedValue([]);
      mockRepo.create.mockReturnValue({});
      mockRepo.save.mockResolvedValue({});
      mockIcebreakerSync.sync.mockResolvedValue(undefined);
      await service.create({
        clientId: 'c1',
        type: RuleType.ICEBREAKER,
        icebreakerQuestion: 'Quero o grupo',
        reply: { text: 'Oi!' },
      });
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ icebreakerQuestion: 'Quero o grupo' }),
      );

      jest.clearAllMocks();
      mockRepo.findOne.mockResolvedValue(null);
      mockRepo.create.mockReturnValue({});
      mockRepo.save.mockResolvedValue({});
      await service.create({
        clientId: 'c1',
        type: RuleType.DEFAULT,
        reply: { text: 'Oi!' },
      });
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ icebreakerQuestion: null }),
      );
    });
  });

  describe('assertReplyNotEmpty — button requires text', () => {
    it('should throw BadRequestException when buttonUrl is set without text', async () => {
      await expect(
        service.create({
          clientId: 'c1',
          type: RuleType.DEFAULT,
          reply: {
            buttonText: 'Entrar',
            buttonUrl: 'https://chat.whatsapp.com/X',
          },
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should accept a reply with text and a button', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      mockRepo.create.mockReturnValue({});
      mockRepo.save.mockResolvedValue({});
      await expect(
        service.create({
          clientId: 'c1',
          type: RuleType.DEFAULT,
          reply: {
            text: 'Oi!',
            buttonText: 'Entrar',
            buttonUrl: 'https://chat.whatsapp.com/X',
          },
        } as any),
      ).resolves.toBeDefined();
    });
  });

  describe('create — icebreaker sync and cap', () => {
    it('should call IcebreakerSyncService.sync with the prospective list before saving', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      mockRepo.find.mockResolvedValue([
        { icebreakerQuestion: 'Q1', triggerValue: 'P1' },
      ]);
      mockRepo.create.mockReturnValue({});
      mockRepo.save.mockResolvedValue({});
      mockIcebreakerSync.sync.mockResolvedValue(undefined);

      await service.create({
        clientId: 'c1',
        type: RuleType.ICEBREAKER,
        icebreakerQuestion: 'Q2',
        reply: { text: 'Oi' },
      });

      expect(mockIcebreakerSync.sync).toHaveBeenCalledWith(
        'c1',
        expect.arrayContaining([
          expect.objectContaining({
            icebreakerQuestion: 'Q1',
            triggerValue: 'P1',
          }),
          expect.objectContaining({ icebreakerQuestion: 'Q2' }),
        ]),
      );
      const syncOrder = mockIcebreakerSync.sync.mock.invocationCallOrder[0];
      const saveOrder = mockRepo.save.mock.invocationCallOrder[0];
      expect(syncOrder).toBeLessThan(saveOrder);
    });

    it('should not call repo.save when sync throws, and should propagate the error', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      mockRepo.find.mockResolvedValue([]);
      const syncError = new Error('Meta rejected the config');
      mockIcebreakerSync.sync.mockRejectedValue(syncError);

      await expect(
        service.create({
          clientId: 'c1',
          type: RuleType.ICEBREAKER,
          icebreakerQuestion: 'Q1',
          reply: { text: 'Oi' },
        } as any),
      ).rejects.toBe(syncError);
      expect(mockRepo.save).not.toHaveBeenCalled();
    });

    it('should throw ConflictException when the client already has 4 active icebreaker rules', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      mockRepo.find.mockResolvedValue([{}, {}, {}, {}]);
      await expect(
        service.create({
          clientId: 'c1',
          type: RuleType.ICEBREAKER,
          icebreakerQuestion: 'Q5',
          reply: { text: 'Oi' },
        } as any),
      ).rejects.toThrow(ConflictException);
      expect(mockIcebreakerSync.sync).not.toHaveBeenCalled();
    });

    it('should not touch IcebreakerSyncService for non-icebreaker rule types', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      mockRepo.create.mockReturnValue({});
      mockRepo.save.mockResolvedValue({});
      await service.create({
        clientId: 'c1',
        type: RuleType.KEYWORD_DM,
        triggerValue: 'oi',
        reply: { text: 'Olá' },
      });
      expect(mockIcebreakerSync.sync).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should throw NotFoundException when rule does not belong to client', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      await expect(
        service.update('rule-id', 'wrong-client', { isActive: false }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should update rule when rule belongs to client', async () => {
      const rule = { id: 'rule-id', clientId: 'c1', isActive: true };
      mockRepo.findOne.mockResolvedValue(rule);
      mockRepo.save.mockResolvedValue({ ...rule, isActive: false });
      const result = await service.update('rule-id', 'c1', { isActive: false });
      expect(result.isActive).toBe(false);
    });

    it('should throw BadRequestException when updating with empty reply', async () => {
      const rule = { id: 'rule-id', clientId: 'c1' };
      mockRepo.findOne.mockResolvedValue(rule);
      await expect(
        service.update('rule-id', 'c1', { reply: {} } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update — immutability guards', () => {
    it('should reject a triggerValue change on an icebreaker rule', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'r1',
        clientId: 'c1',
        type: RuleType.ICEBREAKER,
        triggerValue: 'PAYLOAD_1',
      });
      await expect(
        service.update('r1', 'c1', { triggerValue: 'NEW_PAYLOAD' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject a triggerValue change on a default rule', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'r1',
        clientId: 'c1',
        type: RuleType.DEFAULT,
        triggerValue: null,
      });
      await expect(
        service.update('r1', 'c1', { triggerValue: 'something' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should still allow triggerValue changes on keyword_dm rules', async () => {
      const rule = {
        id: 'r1',
        clientId: 'c1',
        type: RuleType.KEYWORD_DM,
        triggerValue: 'old',
      };
      mockRepo.findOne.mockResolvedValue(rule);
      mockRepo.save.mockResolvedValue({ ...rule, triggerValue: 'new' });
      const result = await service.update('r1', 'c1', {
        triggerValue: 'new',
      });
      expect(result.triggerValue).toBe('new');
    });
  });

  describe('update — icebreaker sync and cap on reactivation', () => {
    it('should throw ConflictException reactivating a 5th icebreaker rule', async () => {
      const rule = {
        id: 'r5',
        clientId: 'c1',
        type: RuleType.ICEBREAKER,
        isActive: false,
        triggerValue: 'P5',
        icebreakerQuestion: 'Q5',
      };
      mockRepo.findOne.mockResolvedValue(rule);
      mockRepo.find.mockResolvedValue([{}, {}, {}, {}]); // 4 already active, excluding this one
      await expect(
        service.update('r5', 'c1', { isActive: true } as any),
      ).rejects.toThrow(ConflictException);
      expect(mockIcebreakerSync.sync).not.toHaveBeenCalled();
    });

    it('should sync before saving when deactivating an icebreaker rule, with it excluded from the prospective list', async () => {
      const rule = {
        id: 'r1',
        clientId: 'c1',
        type: RuleType.ICEBREAKER,
        isActive: true,
        triggerValue: 'P1',
        icebreakerQuestion: 'Q1',
      };
      mockRepo.findOne.mockResolvedValue(rule);
      mockRepo.find.mockResolvedValue([rule]);
      mockRepo.save.mockResolvedValue({ ...rule, isActive: false });
      mockIcebreakerSync.sync.mockResolvedValue(undefined);

      await service.update('r1', 'c1', { isActive: false });

      expect(mockIcebreakerSync.sync).toHaveBeenCalledWith('c1', []);
    });
  });

  describe('remove', () => {
    it('should throw NotFoundException when rule does not belong to client', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      await expect(service.remove('rule-id', 'wrong-client')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should soft-delete rule when it belongs to client', async () => {
      mockRepo.findOne.mockResolvedValue({ id: 'rule-id', clientId: 'c1' });
      mockRepo.softDelete.mockResolvedValue(undefined);
      await expect(service.remove('rule-id', 'c1')).resolves.toBeUndefined();
      expect(mockRepo.softDelete).toHaveBeenCalledWith('rule-id');
    });
  });

  describe('remove — icebreaker sync', () => {
    it('should sync the remaining active list before soft-deleting an icebreaker rule', async () => {
      const rule = {
        id: 'r1',
        clientId: 'c1',
        type: RuleType.ICEBREAKER,
        triggerValue: 'P1',
        icebreakerQuestion: 'Q1',
      };
      mockRepo.findOne.mockResolvedValue(rule);
      mockRepo.find.mockResolvedValue([rule]);
      mockIcebreakerSync.sync.mockResolvedValue(undefined);
      mockRepo.softDelete.mockResolvedValue(undefined);

      await service.remove('r1', 'c1');

      expect(mockIcebreakerSync.sync).toHaveBeenCalledWith('c1', []);
      const syncOrder = mockIcebreakerSync.sync.mock.invocationCallOrder[0];
      const deleteOrder = mockRepo.softDelete.mock.invocationCallOrder[0];
      expect(syncOrder).toBeLessThan(deleteOrder);
    });

    it('should not touch IcebreakerSyncService when removing a non-icebreaker rule', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'r1',
        clientId: 'c1',
        type: RuleType.KEYWORD_DM,
      });
      mockRepo.softDelete.mockResolvedValue(undefined);
      await service.remove('r1', 'c1');
      expect(mockIcebreakerSync.sync).not.toHaveBeenCalled();
    });
  });

  describe('findKeywordRule', () => {
    it('should return null when no keyword rules exist', async () => {
      mockRepo.find.mockResolvedValue([]);
      const result = await service.findKeywordRule('c1', 'hello world');
      expect(result).toBeNull();
    });

    it('should return rule when keyword is contained in text (case-insensitive)', async () => {
      const rule = {
        id: 'r1',
        triggerValue: 'quero',
        type: RuleType.KEYWORD_DM,
      };
      mockRepo.find.mockResolvedValue([rule]);
      const result = await service.findKeywordRule('c1', 'Eu Quero comprar');
      expect(result).toEqual(rule);
    });

    it('should return the longest matching keyword rule', async () => {
      const short = {
        id: 'r1',
        triggerValue: 'quero',
        type: RuleType.KEYWORD_DM,
      };
      const long = {
        id: 'r2',
        triggerValue: 'quero preco',
        type: RuleType.KEYWORD_DM,
      };
      mockRepo.find.mockResolvedValue([short, long]);
      const result = await service.findKeywordRule('c1', 'quero preco agora');
      expect(result).toEqual(long);
    });

    it('should return null when keyword not contained in text', async () => {
      const rule = {
        id: 'r1',
        triggerValue: 'quero',
        type: RuleType.KEYWORD_DM,
      };
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
      const result = await service.findPostRule(
        'c1',
        'post123',
        'quero saber o preço',
      );
      expect(result).toBeNull();
    });

    it('should return the rule when the comment text contains the keyword (case-insensitive)', async () => {
      const rule = {
        id: 'r1',
        triggerValue: 'post123',
        type: RuleType.POST_COMMENT,
        commentKeyword: 'Quero',
      };
      mockRepo.findOne.mockResolvedValue(rule);
      const result = await service.findPostRule(
        'c1',
        'post123',
        'Eu QUERO esse vestido',
      );
      expect(result).toEqual(rule);
      expect(mockRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ triggerValue: 'post123' }),
        }),
      );
    });

    it('should return null when the comment text does not contain the keyword', async () => {
      const rule = {
        id: 'r1',
        triggerValue: 'post123',
        type: RuleType.POST_COMMENT,
        commentKeyword: 'quero',
      };
      mockRepo.findOne.mockResolvedValue(rule);
      const result = await service.findPostRule(
        'c1',
        'post123',
        'lindo esse vestido',
      );
      expect(result).toBeNull();
    });

    it('should return null when the rule has no commentKeyword set', async () => {
      const rule = {
        id: 'r1',
        triggerValue: 'post123',
        type: RuleType.POST_COMMENT,
        commentKeyword: null,
      };
      mockRepo.findOne.mockResolvedValue(rule);
      const result = await service.findPostRule(
        'c1',
        'post123',
        'qualquer coisa',
      );
      expect(result).toBeNull();
    });
  });

  describe('findIcebreakerRule', () => {
    it('should return the rule when payload matches exactly', async () => {
      const rule = {
        id: 'r1',
        triggerValue: 'PAYLOAD_1',
        type: RuleType.ICEBREAKER,
      };
      mockRepo.findOne.mockResolvedValue(rule);
      const result = await service.findIcebreakerRule('c1', 'PAYLOAD_1');
      expect(result).toEqual(rule);
      expect(mockRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: RuleType.ICEBREAKER,
            triggerValue: 'PAYLOAD_1',
          }),
        }),
      );
    });

    it('should return null when no rule has that exact payload', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      const result = await service.findIcebreakerRule('c1', 'UNKNOWN');
      expect(result).toBeNull();
    });
  });

  describe('getRecentPosts', () => {
    it('should call Graph API and return posts page with no next cursor', async () => {
      mockIntegrationsService.findByPageId.mockResolvedValue({
        accessToken: 'enc',
      });
      mockHttp.get.mockReturnValue(
        of({
          data: {
            data: [
              {
                id: '123',
                caption: 'Test',
                timestamp: '2026-09-01T00:00:00Z',
                permalink: 'https://www.instagram.com/p/ABC/',
              },
            ],
            paging: { cursors: { before: 'B', after: 'A' } },
          },
        }),
      );
      const result = await service.getRecentPosts('PAGE123');
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('123');
      expect(result.paging).toBeNull();
      expect(mockHttp.get).toHaveBeenCalledWith(
        'https://graph.facebook.com/v21.0/PAGE123/media',
        expect.objectContaining({
          params: expect.objectContaining({
            access_token: 'plain-token',
            limit: 12,
          }),
        }),
      );
    });

    it('should forward the after cursor and expose paging when Graph API has a next page', async () => {
      mockIntegrationsService.findByPageId.mockResolvedValue({
        accessToken: 'enc',
      });
      mockHttp.get.mockReturnValue(
        of({
          data: {
            data: [
              {
                id: '456',
                caption: null,
                timestamp: '2026-09-02T00:00:00Z',
                permalink: 'https://www.instagram.com/p/DEF/',
              },
            ],
            paging: {
              cursors: { before: 'B2', after: 'A2' },
              next: 'https://graph.facebook.com/next',
            },
          },
        }),
      );
      const result = await service.getRecentPosts('PAGE123', 5, 'A');
      expect(result.paging).toEqual({ cursors: { before: 'B2', after: 'A2' } });
      expect(mockHttp.get).toHaveBeenCalledWith(
        'https://graph.facebook.com/v21.0/PAGE123/media',
        expect.objectContaining({
          params: expect.objectContaining({
            access_token: 'plain-token',
            limit: 5,
            after: 'A',
          }),
        }),
      );
    });

    it('should log the Graph API error response and rethrow on failure', async () => {
      mockIntegrationsService.findByPageId.mockResolvedValue({
        accessToken: 'enc',
      });
      const graphError = {
        response: {
          status: 400,
          data: {
            error: {
              message: 'Unsupported get request.',
              type: 'GraphMethodException',
              code: 100,
              fbtrace_id: 'ABC123',
            },
          },
        },
      };
      mockHttp.get.mockReturnValue(throwError(() => graphError));
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();

      await expect(service.getRecentPosts('PAGE123')).rejects.toBe(graphError);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('PAGE123'));
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unsupported get request.'),
      );
      errorSpy.mockRestore();
    });
  });
});
