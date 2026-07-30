import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { AesCryptoService } from '../../common/crypto/aes.service.js';
import { WhatsAppSessionEntity } from './entities/whatsapp-session.entity.js';
import { WhatsAppAuthKeyEntity } from './entities/whatsapp-auth-key.entity.js';
import { IWhatsAppSessionService } from './interfaces/whatsapp-session-service.interface.js';
import { useDbAuthState } from './db-auth-state.js';

@Injectable()
export class WhatsAppSessionService
  implements IWhatsAppSessionService, OnApplicationBootstrap
{
  private readonly logger = new Logger(WhatsAppSessionService.name);
  private readonly phoneNumber: string;

  private sock: any = null;
  private isConnected = false;
  private currentQr: string | undefined = undefined;
  private pairingCode: string | undefined = undefined;
  private pairingRequested = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;

  constructor(
    @InjectRepository(WhatsAppSessionEntity)
    private readonly repo: Repository<WhatsAppSessionEntity>,
    @InjectRepository(WhatsAppAuthKeyEntity)
    private readonly authKeyRepo: Repository<WhatsAppAuthKeyEntity>,
    private readonly config: ConfigService,
    private readonly crypto: AesCryptoService,
  ) {
    this.phoneNumber = this.config.get<string>('whatsapp.dedicatedPhone') ?? '';
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.phoneNumber) {
      this.logger.warn(
        'WHATSAPP_DEDICATED_PHONE não configurado — sessão Baileys desativada',
      );
      return;
    }
    await this.startSocket();
  }

  private async startSocket(): Promise<void> {
    try {
      const { default: makeWASocket, DisconnectReason, fetchLatestWaWebVersion } =
        await import('@whiskeysockets/baileys');
      const { default: pino } = await import('pino');

      // Duas conexões vivas com a mesma sessão avançam o ratchet do Signal
      // em paralelo e corrompem o estado (Bad MAC) — sempre fecha a anterior.
      this.closeSocket();

      const { state, saveCreds, clear } = await useDbAuthState(
        this.authKeyRepo,
        this.crypto,
        this.phoneNumber,
      );

      const { version } = await fetchLatestWaWebVersion();
      this.logger.log(`Versão WhatsApp Web: ${version.join('.')}`)

      this.sock = makeWASocket({
        auth: state,
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
      });

      this.sock.ev.on('connection.update', async (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.currentQr = qr;
          this.logger.log(
            'QR disponível — escaneie em GET /whatsapp-session/status ou use GET /whatsapp-session/pairing-code para emparelhar pelo número',
          );

          if (!this.pairingRequested && this.phoneNumber) {
            await this.requestPairingCode();
          }
        }

        if (connection === 'open') {
          this.isConnected = true;
          this.currentQr = undefined;
          this.pairingCode = undefined;
          this.pairingRequested = false;
          this.reconnectAttempts = 0;
          this.logger.log('WhatsApp conectado com sucesso');
          await this.persistConnectionStatus(true);
        }

        if (connection === 'close') {
          this.isConnected = false;
          this.pairingRequested = false;
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const loggedOut = statusCode === DisconnectReason.loggedOut;

          if (loggedOut) {
            this.logger.error(
              'WhatsApp deslogado — refaça o emparelhamento via /whatsapp-session/pairing-code',
            );
            await clear();
            await this.persistConnectionStatus(false);
            await this.startSocket();
          } else {
            await this.scheduleReconnect();
          }
        }
      });

      this.sock.ev.on('creds.update', async () => {
        await saveCreds();
      });
    } catch (err) {
      this.logger.error('Erro ao iniciar socket Baileys', err);
    }
  }

  private closeSocket(): void {
    if (!this.sock) return;
    try {
      // Remove os listeners antes de encerrar para o 'close' do socket antigo
      // não disparar um scheduleReconnect concorrente.
      this.sock.ev.removeAllListeners('connection.update');
      this.sock.ev.removeAllListeners('creds.update');
      this.sock.end(undefined);
    } catch {
      // socket já encerrado
    }
    this.sock = null;
    this.isConnected = false;
  }

  private async requestPairingCode(): Promise<void> {
    try {
      const digits = this.phoneNumber.replace(/\D/g, '');
      this.pairingRequested = true;
      const code: string = await this.sock.requestPairingCode(digits);
      this.pairingCode = code;
      this.logger.log(
        `Código de emparelhamento: ${code} — abra WhatsApp → Aparelhos conectados → Conectar aparelho → Usar número de telefone`,
      );
    } catch (err) {
      this.logger.error('Erro ao solicitar código de emparelhamento', err);
      this.pairingRequested = false;
    }
  }

  private async persistConnectionStatus(connected: boolean): Promise<void> {
    try {
      await this.repo.upsert(
        {
          phoneNumber: this.phoneNumber,
          isConnected: connected,
          lastConnectedAt: connected ? new Date() : undefined,
        },
        { conflictPaths: ['phoneNumber'] },
      );
    } catch (err) {
      this.logger.error('Erro ao persistir status de conexão', err);
    }
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error(
        `Máximo de tentativas de reconexão (${this.maxReconnectAttempts}) atingido`,
      );
      return;
    }
    const delayMs = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000);
    this.reconnectAttempts++;
    this.logger.warn(
      `Reconectando em ${delayMs}ms (tentativa ${this.reconnectAttempts})`,
    );
    setTimeout(() => void this.startSocket(), delayMs);
  }

  async getStatus(): Promise<{
    connected: boolean;
    qrCode?: string;
    pairingCode?: string;
  }> {
    return {
      connected: this.isConnected,
      qrCode: this.currentQr,
      pairingCode: this.pairingCode,
    };
  }

  async getPairingCode(): Promise<{ pairingCode: string }> {
    if (!this.sock) {
      throw new ServiceUnavailableException(
        'Socket não inicializado — aguarde o servidor iniciar',
      );
    }
    if (this.isConnected) {
      throw new ServiceUnavailableException('Sessão já está conectada');
    }
    this.pairingRequested = false;
    await this.requestPairingCode();
    if (!this.pairingCode) {
      throw new ServiceUnavailableException(
        'Não foi possível gerar o código — tente novamente',
      );
    }
    return { pairingCode: this.pairingCode };
  }

  async sendMessage(groupJid: string, text: string): Promise<void> {
    if (!this.isConnected || !this.sock) {
      throw new ServiceUnavailableException(
        'Sessão WhatsApp não está conectada',
      );
    }
    await this.sock.sendMessage(groupJid, { text });
  }

  async reconnect(): Promise<void> {
    this.reconnectAttempts = 0;
    await this.startSocket();
  }

  async listGroups(): Promise<
    Array<{ jid: string; subject: string; participantCount: number }>
  > {
    if (!this.isConnected || !this.sock) {
      throw new ServiceUnavailableException(
        'Sessão WhatsApp não está conectada',
      );
    }
    const groups = await this.sock.groupFetchAllParticipating();
    return Object.values(groups).map((g: any) => ({
      jid: g.id,
      subject: g.subject,
      participantCount: g.participants?.length ?? 0,
    }));
  }
}
