# Unified Health Platform — Backend Architecture & Change Log

## 1. Domain & Security Architecture

1. **Universal Patient Base Identity**:
   - Every human user has a base `PatientUser` record (`uniqueId` e.g. `PAT-2026-100001`).
   - Doctors (`DoctorProfile`) and Hospital/Workspace Owners & Staff (`WorkspaceMember`) link directly to their base `PatientUser` identity.
2. **Central Registry (DGHS)**:
   - Bootstrapped via environment variables (`CENTRAL_REGISTRY_EMAIL`, `CENTRAL_REGISTRY_PASSWORD`).
   - Provides centralized ecosystem matrices (`Hospital <-> Doctor`, `Patient <-> Doctor`, `Hospital <-> Patient`, `Maintainer <-> Child/Senior`), dedicated inspection dossiers, status governance, and persistent `recipientCentralRegistry` notifications.
3. **Workspace Dynamic 24-Permission RBAC & Invitation/Acceptance Audit Logs**:
   - Single Primary Owner governance with password-verified ownership transfer.
   - Multi-role permission union across 24 granular permissions in 7 operational domains.
   - **Bi-Directional Audit Logging**:
     - When a Workspace Owner/Admin invites a **Doctor** (`POST /api/workspaces/:workspaceId/doctors/invite`) or **Staff** (`POST /api/workspaces/:workspaceId/staff/invite`), the backend persists a `WorkspaceAuditLog` (`DOCTOR_AFFILIATION_INVITED` / `STAFF_INVITED`), prints `[WORKSPACE_AUDIT_LOG]` to server stdout, and returns `auditLog` directly in the HTTP JSON response.
     - When the **Doctor** (`PATCH /api/doctor/affiliations/:id/respond`) or **Staff** (`PATCH /api/patient/staff-invitations/:memberId/respond`) accepts or revokes, a second `WorkspaceAuditLog` (`DOCTOR_AFFILIATION_ACCEPTED` / `STAFF_INVITATION_ACCEPTED`, etc.) is recorded, printed to console, notified to the Workspace, and returned in `auditLog`.
   - **Affiliation Revoke Undo**: Tracks `statusUpdatedBy` (`DOCTOR` | `WORKSPACE`) on `DoctorWorkspaceAffiliation` so a self-revoked affiliation can be restored (`DOCTOR_AFFILIATION_RESTORED`) via `Undo Revoke`.
4. **2-Hour Patient QR Access & Immutable Prescriptions**:
   - `POST /api/patient/vault/qr-generate` issues 2-hour scoped `QrShareSession` tokens (`QR-XXXXXX`).
   - `POST /api/doctor/prescriptions` enforces active QR pairing and permanently locks (`isImmutable: true`) issued prescriptions (`PATCH`/`DELETE` blocked with HTTP 403).
5. **Appointments**:
   - Supports booking at either an affiliated `Workspace` (`workspaceId`) or the Doctor's Independent Personal Chamber (`workspaceId: "INDEPENDENT_CHAMBER"` / `null`).

---

## 2. Change Log

- **[2026-11-10]**: Initialized 15-model Prisma PostgreSQL schema, JWT/RBAC security middleware, local PostgreSQL bootstrap scripts, Postman v2.1 generator, and integration test suite.
- **[2026-11-11]**:
  - Separated `backend/` into a standalone Git repository with hardened `.gitignore` and sanitized `.env.example`.
  - Added `auditLog` HTTP response payloads and `[WORKSPACE_AUDIT_LOG]` console output on Staff/Doctor invitations and acceptances.
  - Added `statusUpdatedBy` support for Doctor/Workspace `Undo Revoke` and `Re-request` flows.
  - Added Independent Personal Chamber appointment support (`Appointment.workspaceId` optional).
  - Added `recipientCentralRegistry` notification persistence and enriched `GET /api/central-registry/overview` & inspection endpoints with cross-entity connection matrices (`10/10` Vitest + Supertest suites passing).
