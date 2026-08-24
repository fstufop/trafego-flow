import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { HttpLoggerMiddleware } from './common/middleware/http-logger.middleware.js';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { ScheduleModule } from '@nestjs/schedule';
import { createKeyv } from '@keyv/redis';
import { configLoads, validationSchema } from './config/configuration.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { ClientsModule } from './modules/clients/clients.module.js';
import { IntegrationsModule } from './modules/integrations/integrations.module.js';
import { WebhookModule } from './modules/webhook/webhook.module.js';
import { AdAccountsModule } from './modules/ad-accounts/ad-accounts.module.js';
import { CampaignReportsModule } from './modules/campaign-reports/campaign-reports.module.js';
import { AdLibraryModule } from './modules/ad-library/ad-library.module.js';
import { WhatsAppGroupsModule } from './modules/whatsapp-groups/whatsapp-groups.module.js';
import { WhatsAppSessionModule } from './modules/whatsapp-session/whatsapp-session.module.js';
import { AiModule } from './modules/ai/ai.module.js';
import { ReportDispatchesModule } from './modules/report-dispatches/report-dispatches.module.js';
import { AlertJobsModule } from './modules/alert-jobs/alert-jobs.module.js';
import { AdsetAlertsModule } from './modules/adset-alerts/adset-alerts.module.js';
import { MediaLibraryModule } from './modules/media-library/media-library.module.js';

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
        stores: [
          createKeyv({
            url: config.get<string>('redis.url'),
            socket: { connectTimeout: 5000 },
          }),
        ],
        ttl: config.get<number>('redis.cacheTtlSeconds')! * 1000,
      }),
    }),
    ScheduleModule.forRoot(),
    AuthModule,
    HealthModule,
    ClientsModule,
    IntegrationsModule,
    WebhookModule,
    AdAccountsModule,
    CampaignReportsModule,
    AdLibraryModule,
    WhatsAppSessionModule,
    WhatsAppGroupsModule,
    AiModule.forRootAsync(),
    ReportDispatchesModule,
    AlertJobsModule,
    AdsetAlertsModule,
    MediaLibraryModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(HttpLoggerMiddleware).forRoutes('*');
  }
}
