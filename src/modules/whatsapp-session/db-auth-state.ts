import { In, Repository } from 'typeorm';
import { AesCryptoService } from '../../common/crypto/aes.service.js';
import { WhatsAppAuthKeyEntity } from './entities/whatsapp-auth-key.entity.js';

export interface DbAuthState {
  state: { creds: any; keys: any };
  saveCreds: () => Promise<void>;
  clear: () => Promise<void>;
}

/**
 * Auth state do Baileys persistido no Postgres — substitui o
 * useMultiFileAuthState, que grava o estado do Signal em vários arquivos
 * locais (inviável em filesystem efêmero como o do Cloud Run).
 *
 * Espelha o comportamento do useMultiFileAuthState: mesma serialização
 * (BufferJSON) e mesma conversão de app-state-sync-key para proto.
 * Valores são criptografados com AES antes de ir ao banco.
 *
 * Mantém um cache em memória write-through para não pagar uma leitura no
 * banco + decrypt a cada mensagem recebida. Pressupõe uma única instância
 * ativa por telefone — duas instâncias avançando o ratchet em paralelo
 * corrompem a sessão (Bad MAC).
 */
export async function useDbAuthState(
  repo: Repository<WhatsAppAuthKeyEntity>,
  crypto: AesCryptoService,
  phoneNumber: string,
): Promise<DbAuthState> {
  const { initAuthCreds, BufferJSON, proto } =
    await import('@whiskeysockets/baileys');

  const cache = new Map<string, any>();

  const deserialize = (row: WhatsAppAuthKeyEntity): any =>
    JSON.parse(crypto.decrypt(row.valueJson), BufferJSON.reviver);

  const serialize = (value: any): string =>
    crypto.encrypt(JSON.stringify(value, BufferJSON.replacer));

  const readOne = async (keyId: string): Promise<any> => {
    const row = await repo.findOne({ where: { phoneNumber, keyId } });
    return row ? deserialize(row) : null;
  };

  const creds = (await readOne('creds')) ?? initAuthCreds();

  const state = {
    creds,
    keys: {
      get: async (
        type: string,
        ids: string[],
      ): Promise<Record<string, any>> => {
        const result: Record<string, any> = {};
        const missing: string[] = [];

        for (const id of ids) {
          const keyId = `${type}-${id}`;
          if (cache.has(keyId)) result[id] = cache.get(keyId);
          else missing.push(id);
        }

        if (missing.length) {
          const rows = await repo.find({
            where: {
              phoneNumber,
              keyId: In(missing.map((id) => `${type}-${id}`)),
            },
          });
          for (const row of rows) {
            const id = row.keyId.slice(type.length + 1);
            const value = deserialize(row);
            cache.set(row.keyId, value);
            result[id] = value;
          }
        }

        if (type === 'app-state-sync-key') {
          for (const id of Object.keys(result)) {
            result[id] = proto.Message.AppStateSyncKeyData.fromObject(
              result[id],
            );
          }
        }
        return result;
      },
      set: async (data: Record<string, Record<string, any>>): Promise<void> => {
        const upserts: Partial<WhatsAppAuthKeyEntity>[] = [];
        const deletes: string[] = [];

        for (const type of Object.keys(data)) {
          for (const id of Object.keys(data[type])) {
            const keyId = `${type}-${id}`;
            const value = data[type][id];
            if (value) {
              cache.set(keyId, value);
              upserts.push({ phoneNumber, keyId, valueJson: serialize(value) });
            } else {
              cache.delete(keyId);
              deletes.push(keyId);
            }
          }
        }

        if (upserts.length) {
          await repo.upsert(upserts, {
            conflictPaths: ['phoneNumber', 'keyId'],
          });
        }
        if (deletes.length) {
          await repo.delete({ phoneNumber, keyId: In(deletes) });
        }
      },
    },
  };

  return {
    state,
    saveCreds: async () => {
      await repo.upsert(
        { phoneNumber, keyId: 'creds', valueJson: serialize(state.creds) },
        { conflictPaths: ['phoneNumber', 'keyId'] },
      );
    },
    clear: async () => {
      cache.clear();
      await repo.delete({ phoneNumber });
    },
  };
}
