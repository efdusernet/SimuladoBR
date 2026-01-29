import pg from 'pg';
import { config } from '../shared/config.js';

const { Pool } = pg;

let pool = null;

export function getPool() {
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is not configured');
  }

  if (!pool) {
    pool = new Pool({ connectionString: config.databaseUrl });
  }

  return pool;
}
