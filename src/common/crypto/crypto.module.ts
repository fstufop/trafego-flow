import { Module } from '@nestjs/common';
import { AesCryptoService } from './aes.service.js';

@Module({
  providers: [AesCryptoService],
  exports: [AesCryptoService],
})
export class CryptoModule {}
