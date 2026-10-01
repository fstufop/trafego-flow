import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class DatabaseKeepaliveService {
  private readonly logger = new Logger(DatabaseKeepaliveService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Cron('*/10 * * * *')
  async ping(): Promise<void> {
    try {
      await this.dataSource.query('SELECT 1');
      this.logger.debug('Supabase keepalive ping OK');
    } catch (err) {
      this.logger.error('Supabase keepalive ping falhou', err);
    }
  }
}
