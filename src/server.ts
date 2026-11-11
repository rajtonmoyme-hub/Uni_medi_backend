import { app } from './app';
import { env } from './config/env';
import { ensureLocalPostgres } from './scripts/ensure-postgres';

async function bootstrap() {
  await ensureLocalPostgres();

  app.listen(env.PORT, '0.0.0.0', () => {
    console.log(
      `\n==================================================================`
    );
    console.log(
      ` Unified Health Platform API running on http://localhost:${env.PORT}`
    );
    console.log(
      ` Central Registry (DGHS): ${env.CENTRAL_REGISTRY.EMAIL} (via .env)`
    );
    console.log(
      `==================================================================\n`
    );
  });
}

bootstrap().catch((err) => {
  console.error('Failed to bootstrap backend server:', err);
  process.exit(1);
});
