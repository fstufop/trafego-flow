import { Module } from '@nestjs/common';
import { CsvFormatterService } from './csv-formatter.service.js';

@Module({
  providers: [CsvFormatterService],
  exports: [CsvFormatterService],
})
export class CsvModule {}
