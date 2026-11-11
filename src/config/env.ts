import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const env = {
  PORT: parseInt(process.env.PORT || '4000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  DEMO_MODE: process.env.DEMO_MODE !== 'false',
  DATABASE_URL:
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5432/unified_medi?schema=public',
  PG_PORT: parseInt(process.env.PG_PORT || '5432', 10),
  PG_USER: process.env.PG_USER || 'postgres',
  PG_PASSWORD: process.env.PG_PASSWORD || 'postgres',
  PG_DB: process.env.PG_DB || 'unified_medi',

  JWT_SECRET:
    process.env.JWT_SECRET || 'unified-medi-super-secret-jwt-key-2026-dghs-compliant',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '24h',

  CENTRAL_REGISTRY: {
    EMAIL: process.env.CENTRAL_REGISTRY_EMAIL || 'dghs@health.gov.bd',
    PASSWORD: process.env.CENTRAL_REGISTRY_PASSWORD || 'DGHS@Admin2026!',
    NAME:
      process.env.CENTRAL_REGISTRY_NAME ||
      'Directorate General of Health Services (DGHS)',
    CODE: process.env.CENTRAL_REGISTRY_CODE || 'DGHS-BD-CENTRAL-01',
    PHONE: process.env.CENTRAL_REGISTRY_PHONE || '+8801700000000',
  },

  SMTP: {
    HOST: process.env.SMTP_HOST || '',
    PORT: parseInt(process.env.SMTP_PORT || '587', 10),
    USER: process.env.SMTP_USER || '',
    PASS: process.env.SMTP_PASS || '',
    FROM: process.env.MAIL_FROM || 'Unified Health Platform <noreply@example.com>',
  },
};
