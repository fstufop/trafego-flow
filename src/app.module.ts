import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { ScheduleModule } from '@nestjs/schedule';
import { createKeyv } from '@keyv/redis';
import { configLoads, validationSchema } from './config/configuration.js';
import { HealthModule } from './modules/health/health.module.js';
import { ClientsModule } from './modules/clients/clients.module.js';
import { IntegrationsModule } from './modules/integrations/integrations.module.js';
import { WebhookModule } from './modules/webhook/webhook.module.js';
import { AdAccountsModule } from './modules/ad-accounts/ad-accounts.module.js';
import { CampaignReportsModule } from './modules/campaign-reports/campaign-reports.module.js';
import { AdLibraryModule } from './modules/ad-library/ad-library.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: configLoads,
      validationSchema,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('database.url'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        migrations: [__dirname + '/database/migrations/*{.ts,.js}'],
        synchronize: false,
        logging: config.get<string>('app.nodeEnv') === 'development',
      }),
    }),
    CacheModule.registerAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        stores: [createKeyv(config.get<string>('redis.url'))],
        ttl: config.get<number>('redis.cacheTtlSeconds')! * 1000,
      }),
    }),
    ScheduleModule.forRoot(),
    HealthModule,
    ClientsModule,
    IntegrationsModule,
    WebhookModule,
    AdAccountsModule,
    CampaignReportsModule,
    AdLibraryModule,
  ],
})
export class AppModule {}
