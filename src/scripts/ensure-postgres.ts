import EmbeddedPostgres from 'embedded-postgres';
import net from 'net';
import path from 'path';
import { Client } from 'pg';
import { env } from '../config/env';

const PG_DATA_DIR = path.resolve(__dirname, '../../.pgdata');

function isPortListening(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

async function ensureDatabaseExists() {
  const client = new Client({
    host: '127.0.0.1',
    port: env.PG_PORT,
    user: env.PG_USER,
    password: env.PG_PASSWORD,
    database: 'postgres',
  });
  await client.connect();
  const res = await client.query(
    'SELECT 1 FROM pg_database WHERE datname = $1',
    [env.PG_DB]
  );
  if (res.rowCount === 0) {
    await client.query(`CREATE DATABASE "${env.PG_DB}"`);
    console.log(`[Postgres] Created database '${env.PG_DB}'`);
  }
  await client.end();
}

let pgInstance: EmbeddedPostgres | null = null;

export async function ensureLocalPostgres(): Promise<void> {
  const running = await isPortListening(env.PG_PORT);
  if (running) {
    try {
      await ensureDatabaseExists();
      console.log(
        `[Postgres] Local PostgreSQL is already active on port ${env.PG_PORT}`
      );
      return;
    } catch (err: any) {
      console.log(
        `[Postgres] Port ${env.PG_PORT} is active; continuing with configured DATABASE_URL.`
      );
      return;
    }
  }

  console.log(
    `[Postgres] Starting native local PostgreSQL cluster on port ${env.PG_PORT}...`
  );
  pgInstance = new EmbeddedPostgres({
    databaseDir: PG_DATA_DIR,
    user: env.PG_USER,
    password: env.PG_PASSWORD,
    port: env.PG_PORT,
    persistent: true,
    onLog: () => {},
    onError: (msg) => {
      // Suppress non-fatal notices
      if (String(msg).includes('FATAL')) {
        console.error('[Postgres Error]', msg);
      }
    },
  });

  try {
    await pgInstance.initialise();
  } catch (err: any) {
    // Already initialized in .pgdata
  }

  await pgInstance.start();
  await ensureDatabaseExists();
  console.log(
    `[Postgres] Native PostgreSQL server ready at postgresql://${env.PG_USER}:***@localhost:${env.PG_PORT}/${env.PG_DB}`
  );
}

if (require.main === module) {
  ensureLocalPostgres()
    .then(() => {
      console.log('[Postgres] Check complete.');
    })
    .catch((err) => {
      console.error('[Postgres] Failed to start local Postgres:', err);
      process.exit(1);
    });
}
