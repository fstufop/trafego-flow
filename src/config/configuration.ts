import * as Joi from 'joi';
import appConfig from './app.config';
import databaseConfig from './database.config';
import redisConfig from './redis.config';

export const configLoads = [appConfig, databaseConfig, redisConfig];

export const validationSchema = Joi.object({
  PORT: Joi.number().default(3000),
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  MASTER_API_KEY: Joi.string().required(),
  DATABASE_URL: Joi.string().uri().required(),
  REDIS_URL: Joi.string().required(),
  CACHE_TTL_SECONDS: Joi.number().default(3600),
});
