import * as Joi from 'joi';
import appConfig from './app.config';
import databaseConfig from './database.config';
import redisConfig from './redis.config';
import metaConfig from './meta.config';
import metaAdsConfig from './meta-ads.config';
import whatsappConfig from './whatsapp.config';
import authConfig from './auth.config';
import googleConfig from './google.config';

export const configLoads = [
  appConfig,
  databaseConfig,
  redisConfig,
  metaConfig,
  metaAdsConfig,
  whatsappConfig,
  authConfig,
  googleConfig,
];

export const validationSchema = Joi.object({
  PORT: Joi.number().default(3000),
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  MASTER_API_KEY: Joi.string().required(),
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('1d'),
  DATABASE_URL: Joi.string().uri().required(),
  REDIS_URL: Joi.string().required(),
  CACHE_TTL_SECONDS: Joi.number().default(3600),
  ENCRYPTION_KEY: Joi.string().length(64).required(),
  META_APP_ID: Joi.string().default('1001996369089789'),
  META_APP_SECRET: Joi.string().required(),
  META_SYSTEM_USER_TOKEN: Joi.string().optional(),
  META_VERIFY_TOKEN: Joi.string().required(),
  META_GRAPH_API_URL: Joi.string().uri().default('https://graph.facebook.com'),
  META_GRAPH_API_VERSION: Joi.string().default('v21.0'),
  META_ADS_API_VERSION: Joi.string().default('v21.0'),
  INSIGHTS_CACHE_TTL_SECONDS: Joi.number().min(30).max(3600).default(300),
  WHATSAPP_DEDICATED_PHONE: Joi.string().optional(),
  AI_PROVIDER: Joi.string().valid('openai', 'gemini').default('openai'),
  AI_MODEL: Joi.string().default('gpt-4o-mini'),
  OPENAI_API_KEY: Joi.string().optional(),
  GEMINI_API_KEY: Joi.string().optional(),
  MANAGERS_GROUP_JID: Joi.string().optional(),
  GOOGLE_CLIENT_ID: Joi.string().optional(),
  GOOGLE_CLIENT_SECRET: Joi.string().optional(),
  GOOGLE_REFRESH_TOKEN: Joi.string().optional(),
  GOOGLE_DRIVE_ROOT_FOLDER_ID: Joi.string().optional(),
  MAX_FILE_SIZE_MB: Joi.number().default(500),
});
