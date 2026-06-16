import * as Joi from 'joi';
import appConfig from './app.config';
import databaseConfig from './database.config';
import redisConfig from './redis.config';
import metaConfig from './meta.config';
import metaAdsConfig from './meta-ads.config';

export const configLoads = [appConfig, databaseConfig, redisConfig, metaConfig, metaAdsConfig];

export const validationSchema = Joi.object({
  PORT: Joi.number().default(3000),
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  MASTER_API_KEY: Joi.string().required(),
  DATABASE_URL: Joi.string().uri().required(),
  REDIS_URL: Joi.string().required(),
  CACHE_TTL_SECONDS: Joi.number().default(3600),
  ENCRYPTION_KEY: Joi.string().length(64).required(),
  META_APP_SECRET: Joi.string().required(),
  META_VERIFY_TOKEN: Joi.string().required(),
  META_GRAPH_API_URL: Joi.string().uri().default('https://graph.facebook.com'),
  META_GRAPH_API_VERSION: Joi.string().default('v21.0'),
  META_ADS_API_VERSION: Joi.string().default('v21.0'),
  INSIGHTS_CACHE_TTL_SECONDS: Joi.number().min(30).max(3600).default(300),
});
