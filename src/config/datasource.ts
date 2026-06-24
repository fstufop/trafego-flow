import 'reflect-metadata';
import { DataSource } from 'typeorm';
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config();

const isCompiled = __filename.endsWith('.js');

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [isCompiled ? 'dist/**/*.entity.js' : 'src/**/*.entity.ts'],
  migrations: [isCompiled ? 'dist/database/migrations/*.js' : 'src/database/migrations/*.ts'],
  synchronize: false,
});
