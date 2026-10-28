import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { UserEntity } from './entities/user.entity.js';
import { ClientPortalUserEntity } from './entities/client-portal-user.entity.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { ClientPortalAuthController } from './client-portal-auth.controller.js';
import { ClientPortalAuthService } from './client-portal-auth.service.js';
import { ClientPortalScopeGuard } from './guards/client-portal-scope.guard.js';
import { MailModule } from '../mail/mail.module.js';
import { ClientsModule } from '../clients/clients.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, ClientPortalUserEntity]),
    MailModule,
    ClientsModule,
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('auth.jwtSecret'),
        signOptions: {
          expiresIn: config.get<string>(
            'auth.jwtExpiresIn',
          ) as JwtSignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [AuthController, ClientPortalAuthController],
  providers: [AuthService, ClientPortalAuthService, ClientPortalScopeGuard],
  exports: [AuthService, ClientPortalAuthService, ClientPortalScopeGuard],
})
export class AuthModule {}
