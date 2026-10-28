import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ClientPortalUserEntity } from './entities/client-portal-user.entity.js';
import { CreateClientPortalUserDto } from './dto/create-client-portal-user.dto.js';
import { ClientLoginDto } from './dto/client-login.dto.js';
import { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { MailService } from '../mail/mail.service.js';
import { ClientsService } from '../clients/clients.service.js';
import { ClientEntity } from '../clients/entities/client.entity.js';
import {
  CLIENT_PORTAL_RESET_TOKEN_TTL_MS,
  CLIENT_PORTAL_SCOPE,
} from './constants/client-portal.constant.js';
import { JwtPayload } from './interfaces/auth-service.interface.js';

const BCRYPT_ROUNDS = 12;

export interface ClientPortalLoginResult {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
}

@Injectable()
export class ClientPortalAuthService {
  private readonly logger = new Logger(ClientPortalAuthService.name);

  constructor(
    @InjectRepository(ClientPortalUserEntity)
    private readonly repo: Repository<ClientPortalUserEntity>,
    private readonly mailService: MailService,
    private readonly config: ConfigService,
    private readonly clientsService: ClientsService,
    private readonly jwtService: JwtService,
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

  async login(dto: ClientLoginDto): Promise<ClientPortalLoginResult> {
    const user = await this.repo.findOne({
      where: { email: dto.email, isActive: true },
    });

    if (!user || user.passwordHash === null) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    let client: ClientEntity;
    try {
      client = await this.clientsService.findOne(user.clientId);
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw new UnauthorizedException('Invalid credentials');
      }
      throw err;
    }
    if (!client.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = {
      sub: user.id,
      clientId: user.clientId,
      scope: CLIENT_PORTAL_SCOPE,
    };

    return {
      accessToken: await this.jwtService.signAsync(payload),
      tokenType: 'Bearer',
      expiresIn: this.config.get<string>('auth.jwtExpiresIn')!,
    };
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    const user = await this.repo.findOne({ where: { email: dto.email } });
    if (!user) {
      return;
    }

    // Deliberately not awaited: forgotPassword must resolve identically
    // (same control flow, same latency) whether the email exists or not,
    // per the binding "resolve silently" constraint. Awaiting the token
    // generation + Mailgun round-trip here would make an existing email
    // both slower and able to reject (propagating a 500) compared to the
    // not-found path above, which leaks account existence via timing and
    // via errors. Failures are logged, never surfaced to the caller.
    this.sendResetPasswordEmail(user).catch((err: Error) => {
      this.logger.error(
        `Failed to complete forgot-password request for ${user.email}: ${err.message}`,
      );
    });
  }

  private async sendResetPasswordEmail(
    user: ClientPortalUserEntity,
  ): Promise<void> {
    const token = await this.generateAndStoreToken(user);
    const portalUrl = this.config.get<string>('mailgun.portalUrl');
    const link = `${portalUrl}/redefinir-senha?token=${token}`;
    await this.mailService.send({
      to: user.email,
      subject: 'Redefinição de senha do portal do cliente',
      html: `<p>Recebemos uma solicitação para redefinir sua senha. Clique no link para continuar: <a href="${link}">${link}</a></p>`,
    });
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const tokenHash = crypto
      .createHash('sha256')
      .update(dto.token)
      .digest('hex');

    const user = await this.repo.findOne({
      where: { passwordResetTokenHash: tokenHash },
    });

    if (
      !user ||
      !user.passwordResetExpiresAt ||
      user.passwordResetExpiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    user.passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    user.passwordResetTokenHash = null;
    user.passwordResetExpiresAt = null;
    await this.repo.save(user);
  }

  /**
   * Confirms that a client-portal principal may only touch data belonging
   * to its own client. Non-client-portal payloads (e.g. admin session
   * tokens) are out of scope for this check and pass through silently —
   * they're subject to RolesGuard/ClientPortalAuthGuard instead.
   */
  async assertAccess(
    payload: JwtPayload,
    targetClientId: string | undefined,
  ): Promise<void> {
    if (payload.scope !== CLIENT_PORTAL_SCOPE) {
      return;
    }

    if (!targetClientId || targetClientId !== payload.clientId) {
      throw new ForbiddenException('Access denied');
    }

    const user = await this.repo.findOne({ where: { id: payload.sub } });
    if (!user || !user.isActive) {
      throw new ForbiddenException('Access denied');
    }

    let client: ClientEntity;
    try {
      client = await this.clientsService.findOne(targetClientId);
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw new ForbiddenException('Access denied');
      }
      throw err;
    }

    if (!client.isActive) {
      throw new ForbiddenException('Access denied');
    }
  }
}
