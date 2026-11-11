# Unified Health Platform — Backend API

Standalone Express + TypeScript + Prisma + PostgreSQL REST API for the Unified Health Platform (National DGHS Central Registry, Patient Medical Vault & Family Proxy, BMDC Doctor Portal, and Multi-Role Hospital/Diagnostic Workspace Governance).

## Tech Stack
- **Runtime**: Node.js + TypeScript + Express
- **Database & ORM**: PostgreSQL + Prisma (`prisma/schema.prisma`, 15 relational models)
- **Security**: JWT Bearer Authentication, `bcrypt`, `helmet`, tiered `express-rate-limit` (`authRateLimiter`, `apiRateLimiter`, `qrRateLimiter`), Dynamic 24-Permission RBAC Guard
- **API Contract & Testing**: Vitest + Supertest (`tests/api.test.ts`), Postman v2.1 Collection (`postman/`)

## Quick Start

1. Create a local `.env` file (excluded from Git via `.gitignore`) with your database, JWT, Central Registry, and SMTP settings (`PORT`, `DATABASE_URL`, `JWT_SECRET`, `CENTRAL_REGISTRY_EMAIL`, `CENTRAL_REGISTRY_PASSWORD`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`), then install dependencies:
   ```bash
   npm install
   ```
2. Initialize PostgreSQL schema and seed demo data:
   ```bash
   npm run db:setup
   ```
3. Start development server (`http://localhost:4000`):
   ```bash
   npm run dev
   ```
4. Run integration tests & build:
   ```bash
   npm test
   npm run build
   ```
5. Regenerate Postman Collection & Environment:
   ```bash
   npm run postman:generate
   ```

## Security Notice
Never commit `.env`, `.pgdata/`, `node_modules/`, or API keys. `.gitignore` is pre-configured to exclude all environment files and credential artifacts.
