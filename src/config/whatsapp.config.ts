import { registerAs } from '@nestjs/config';

export default registerAs('whatsapp', () => ({
  dedicatedPhone: process.env.WHATSAPP_DEDICATED_PHONE,
}));
