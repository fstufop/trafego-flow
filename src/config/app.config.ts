import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  masterApiKey: process.env.MASTER_API_KEY,
  encryptionKey: process.env.ENCRYPTION_KEY,
}));
