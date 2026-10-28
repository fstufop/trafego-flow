import * as crypto from 'crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ClientPortalUserEntity } from './entities/client-portal-user.entity.js';
import { CreateClientPortalUserDto } from './dto/create-client-portal-user.dto.js';
import { MailService } from '../mail/mail.service.js';
import { CLIENT_PORTAL_RESET_TOKEN_TTL_MS } from './constants/client-portal.constant.js';

@Injectable()
export class ClientPortalAuthService {
  constructor(
    @InjectRepository(ClientPortalUserEntity)
    private readonly repo: Repository<ClientPortalUserEntity>,
    private readonly mailService: MailService,
    private readonly config: ConfigService,
  ) {}

  private async generateAndStoreToken(
    user: ClientPortalUserEntity,
  ): Promise<string> {
    const token = crypto.randomBytes(32).toString('hex');
    user.passwordResetTokenHash = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');
    user.passwordResetExpiresAt = new Date(
      Date.now() + CLIENT_PORTAL_RESET_TOKEN_TTL_MS,
    );
    await this.repo.save(user);
    return token;
  }

  private async sendInviteEmail(
    user: ClientPortalUserEntity,
    token: string,
  ): Promise<void> {
    const portalUrl = this.config.get<string>('mailgun.portalUrl');
    const link = `${portalUrl}/definir-senha?token=${token}`;
    await this.mailService.send({
      to: user.email,
      subject: 'Convite para o portal do cliente',
      html: `<p>Você foi convidado para acessar o portal do cliente. Clique no link para definir sua senha: <a href="${link}">${link}</a></p>`,
    });
  }

  async createAccount(
    dto: CreateClientPortalUserDto,
  ): Promise<ClientPortalUserEntity> {
    const user = this.repo.create({
      clientId: dto.clientId,
      email: dto.email,
      passwordHash: null,
    });

    try {
      await this.repo.save(user);
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        (err as QueryFailedError & { code: string }).code === '23505'
      ) {
        throw new ConflictException(
          'A client portal account with this email already exists',
        );
      }
      throw err;
    }

    const token = await this.generateAndStoreToken(user);
    await this.sendInviteEmail(user, token);

    return user;
  }

  async resendInvite(id: string): Promise<void> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('Client portal account not found');
    }

    const token = await this.generateAndStoreToken(user);
    await this.sendInviteEmail(user, token);
  }

  async findByClient(clientId: string): Promise<ClientPortalUserEntity | null> {
    return this.repo.findOne({ where: { clientId } });
  }

  async setActive(
    id: string,
    isActive: boolean,
  ): Promise<ClientPortalUserEntity> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('Client portal account not found');
    }

    user.isActive = isActive;
    return this.repo.save(user);
  }
}
