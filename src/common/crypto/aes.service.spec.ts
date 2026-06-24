import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AesCryptoService } from './aes.service.js';

const MOCK_KEY = 'a'.repeat(64); // 32 bytes em hex válido para AES-256

describe('AesCryptoService', () => {
  let service: AesCryptoService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AesCryptoService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(MOCK_KEY) },
        },
      ],
    }).compile();

    service = module.get<AesCryptoService>(AesCryptoService);
  });

  it('encrypt/decrypt roundtrip retorna o texto original', () => {
    const original = 'EAABsbCS7Zolg_token_secreto_do_instagram';
    expect(service.decrypt(service.encrypt(original))).toBe(original);
  });

  it('dois encrypts do mesmo texto produzem ciphertexts diferentes (IV aleatório)', () => {
    const text = 'mesmo-texto';
    expect(service.encrypt(text)).not.toBe(service.encrypt(text));
  });

  it('decrypt com ciphertext adulterado lança erro (GCM auth tag inválida)', () => {
    const encrypted = service.encrypt('texto-original');
    const buf = Buffer.from(encrypted, 'base64');
    // Adulterar um byte no ciphertext (após IV de 12B e tag de 16B)
    buf[30] = buf[30] ^ 0xff;
    expect(() => service.decrypt(buf.toString('base64'))).toThrow();
  });
});
