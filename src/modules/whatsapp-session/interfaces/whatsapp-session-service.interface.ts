export interface IWhatsAppSessionService {
  getStatus(): Promise<{ connected: boolean; qrCode?: string }>;
  sendMessage(groupJid: string, text: string): Promise<void>;
  reconnect(): Promise<void>;
}
