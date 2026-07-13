import { Column, Entity, Unique } from 'typeorm';
import { Exclude } from 'class-transformer';
import { BaseEntity } from '../../../common/database/base.entity.js';

/**
 * Estado de autenticação do Baileys (protocolo Signal) por telefone.
 * Cada linha é uma chave do auth state: 'creds', 'session-<jid>',
 * 'pre-key-<n>', 'sender-key-<...>', 'app-state-sync-key-<id>', etc.
 * O ratchet do Signal avança a cada mensagem — perder ou regredir essas
 * linhas causa "Bad MAC" na descriptografia.
 */
@Entity('whatsapp_auth_keys')
@Unique('UQ_whatsapp_auth_keys_phone_key', ['phoneNumber', 'keyId'])
export class WhatsAppAuthKeyEntity extends BaseEntity {
  @Column({ name: 'phone_number' })
  phoneNumber: string;

  @Column({ name: 'key_id' })
  keyId: string;

  @Exclude()
  @Column({ name: 'value_json', type: 'text' })
  valueJson: string;
}
