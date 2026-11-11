import { execSync } from 'child_process';
import path from 'path';
import { ensureLocalPostgres } from './ensure-postgres';

async function main() {
  await ensureLocalPostgres();

  const rootDir = path.resolve(__dirname, '../..');

  console.log('[Setup-DB] Pushing Prisma schema to PostgreSQL...');
  execSync('npx prisma db push --accept-data-loss', {
    cwd: rootDir,
    stdio: 'inherit',
  });

  execSync('npx tsx prisma/seed.ts', {
    cwd: rootDir,
    stdio: 'inherit',
  });

  console.log('[Setup-DB] Database setup & demo seed complete!');
  process.exit(0);
}

main().catch((err) => {
  console.error('[Setup-DB] Error:', err);
  process.exit(1);
});
