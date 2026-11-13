import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { ensureLocalPostgres } from '../src/scripts/ensure-postgres';
import { seedDatabase } from '../prisma/seed';
import { prisma } from '../src/config/prisma';

describe('Unified Health Platform — Comprehensive End-to-End API & Security Suite', () => {
  let dghsToken = '';
  let patientToken = '';
  let doctorToken = '';
  let ownerToken = '';
  let adminToken = '';
  let multiStaffToken = '';
  let labStaffToken = '';

  let tanvirId = '';
  let childAyaanId = '';
  let seniorKarimId = '';
  let drRahmanId = '';
  let pendingDoctorId = '';
  let evercareWorkspaceId = '';
  let pendingWorkspaceId = '';
  let generatedQrSessionId = '';
  let generatedQrShortCode = '';
  let issuedPrescriptionId = '';

  beforeAll(async () => {
    await ensureLocalPostgres();
    await seedDatabase();
  }, 60000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('01. Health check and public showcase return healthy status and featured 10,000 Tk package', async () => {
    const healthRes = await request(app).get('/api/health');
    expect(healthRes.status).toBe(200);
    expect(healthRes.body.status).toBe('OK');

    const showcaseRes = await request(app).get('/api/public/showcase');
    expect(showcaseRes.status).toBe(200);
    expect(showcaseRes.body.featuredPackages.length).toBeGreaterThan(0);
    const fullBodyPkg = showcaseRes.body.featuredPackages.find(
      (p: any) => p.price === 10000
    );
    expect(fullBodyPkg).toBeDefined();
    expect(fullBodyPkg.title).toContain('Full Body Checkup');
  });

  it('02. Central Registry (DGHS) authenticates via .env credentials and blocks non-DGHS users', async () => {
    const loginRes = await request(app).post('/api/auth/login').send({
      identifier: 'dghs@health.gov.bd',
      password: 'DGHS@Admin2026!',
    });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user.isCentralRegistry).toBe(true);
    dghsToken = loginRes.body.token;

    // Login as normal patient and verify they are blocked from Central Registry
    const patLogin = await request(app).post('/api/auth/login').send({
      identifier: 'patient@demo.bd',
      password: 'Demo@2026',
    });
    expect(patLogin.status).toBe(200);
    patientToken = patLogin.body.token;
    tanvirId = patLogin.body.user.patient.id;

    const forbiddenRes = await request(app)
      .get('/api/central-registry/overview')
      .set('Authorization', `Bearer ${patientToken}`);
    expect(forbiddenRes.status).toBe(403);
  });

  it('03. Patient registration + OTP verification flow works end-to-end', async () => {
    const regRes = await request(app).post('/api/auth/patient/register').send({
      name: 'Test New Patient',
      email: 'newpatient.e2e@demo.bd',
      phone: '+8801700998877',
      password: 'Demo@2026',
      accountType: 'NORMAL',
    });
    expect(regRes.status).toBe(201);
    expect(regRes.body.uniqueId).toMatch(/^PAT-2026-/);
    expect(regRes.body.demoOtpHint).toHaveLength(6);

    // Login before OTP verification should be blocked with 403 requiresOtp
    const prematureLogin = await request(app).post('/api/auth/login').send({
      identifier: 'newpatient.e2e@demo.bd',
      password: 'Demo@2026',
    });
    expect(prematureLogin.status).toBe(403);
    expect(prematureLogin.body.requiresOtp).toBe(true);

    // Verify OTP
    const verifyRes = await request(app)
      .post('/api/auth/patient/verify-otp')
      .send({
        identifier: 'newpatient.e2e@demo.bd',
        otpCode: regRes.body.demoOtpHint,
      });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.token).toBeDefined();
    expect(verifyRes.body.user.patient.isOtpVerified).toBe(true);
  });

  it('04. Doctor registration automatically creates a linked base Patient account for navbar switching', async () => {
    const docRegRes = await request(app)
      .post('/api/auth/doctor/register')
      .send({
        name: 'Dr. Shafiqul Islam',
        email: 'dr.shafiq@demo.bd',
        phone: '+8801755443322',
        password: 'Demo@2026',
        doctorLicense: 'BMDC-A-99887',
        nationalId: '1983269489988',
        specialty: 'Orthopedics',
        degrees: ['MBBS', 'MS (Ortho)'],
        area: 'Dhanmondi, Dhaka',
        defaultConsultationFee: 1200,
      });

    expect(docRegRes.status).toBe(201);
    expect(docRegRes.body.user.patient.uniqueId).toMatch(/^PAT-2026-/);
    expect(docRegRes.body.user.doctorProfile.doctorIdCode).toMatch(/^DOC-2026-/);
    expect(docRegRes.body.user.doctorProfile.approvalStatus).toBe('PENDING');
    pendingDoctorId = docRegRes.body.user.doctorProfile.id;
  });

  it('05. Workspace (Hospital) registration (Option A) auto-creates Single Primary Owner Patient account and default RBAC roles', async () => {
    const wsRegRes = await request(app)
      .post('/api/auth/workspace/register')
      .send({
        workspaceName: 'Apollo Imperial Diagnostic & Clinic',
        type: 'CLINIC',
        registrationLicense: 'DGHS-CLIN-2026-555',
        workspaceEmail: 'info@apolloimperial-demo.bd',
        workspacePhone: '+8801766112233',
        address: 'Road 27, Dhanmondi, Dhaka',
        area: 'Dhanmondi, Dhaka',
        ownerName: 'Kamrul Hasan',
        ownerEmail: 'owner.apollo@demo.bd',
        ownerPhone: '+8801766112233',
        ownerPassword: 'Demo@2026',
        ownerNationalId: '1978269485555',
      });

    expect(wsRegRes.status).toBe(201);
    expect(wsRegRes.body.workspace.approvalStatus).toBe('PENDING');
    expect(wsRegRes.body.user.patient.uniqueId).toMatch(/^PAT-2026-/);
    expect(wsRegRes.body.user.workspaces[0].isOwner).toBe(true);
    expect(wsRegRes.body.user.workspaces[0].combinedPermissions).toHaveLength(24);
    pendingWorkspaceId = wsRegRes.body.workspace.id;
  });

  it('06. Central Registry inspects and manages Patients, Doctors (multi-workspace fees), and Hospitals', async () => {
    const overviewRes = await request(app)
      .get('/api/central-registry/overview')
      .set('Authorization', `Bearer ${dghsToken}`);
    expect(overviewRes.status).toBe(200);
    expect(overviewRes.body.metrics.patients.total).toBeGreaterThanOrEqual(8);

    // Inspect Patient Tanvir Ahmed (Vault, Activities, Child & Senior Family links, Doctor connections)
    const patInspect = await request(app)
      .get(`/api/central-registry/patients/${tanvirId}/inspect`)
      .set('Authorization', `Bearer ${dghsToken}`);
    expect(patInspect.status).toBe(200);
    expect(patInspect.body.patient.maintainedDependents.length).toBe(2);
    expect(patInspect.body.doctorConnections.length).toBeGreaterThan(0);

    // Disable & Re-enable Patient Account
    const disableRes = await request(app)
      .patch(`/api/central-registry/patients/${tanvirId}/status`)
      .set('Authorization', `Bearer ${dghsToken}`)
      .send({ status: 'DISABLED', reason: 'Temporary audit test' });
    expect(disableRes.status).toBe(200);

    // Verify disabled patient cannot access protected API
    const blockedRes = await request(app)
      .get('/api/patient/dashboard')
      .set('Authorization', `Bearer ${patientToken}`);
    expect(blockedRes.status).toBe(403);

    // Re-enable Patient Account
    const enableRes = await request(app)
      .patch(`/api/central-registry/patients/${tanvirId}/status`)
      .set('Authorization', `Bearer ${dghsToken}`)
      .send({ status: 'ACTIVE' });
    expect(enableRes.status).toBe(200);

    // Approve pending Doctor in Central Registry
    const approveDocRes = await request(app)
      .patch(`/api/central-registry/doctors/${pendingDoctorId}/status`)
      .set('Authorization', `Bearer ${dghsToken}`)
      .send({
        approvalStatus: 'APPROVED',
        dghsNotes: 'Cross-checked BMDC license and NID.',
      });
    expect(approveDocRes.status).toBe(200);
    expect(approveDocRes.body.doctor.approvalStatus).toBe('APPROVED');

    // Approve pending Workspace in Central Registry
    const approveWsRes = await request(app)
      .patch(`/api/central-registry/workspaces/${pendingWorkspaceId}/status`)
      .set('Authorization', `Bearer ${dghsToken}`)
      .send({
        approvalStatus: 'APPROVED',
        dghsNotes: 'DGHS license verified.',
      });
    expect(approveWsRes.status).toBe(200);
    expect(approveWsRes.body.workspace.approvalStatus).toBe('APPROVED');
  });

  it('07. Patient Vault, Family Maintainer Full Proxy Access, and 2-Hour QR Code Generation work seamlessly', async () => {
    const dashRes = await request(app)
      .get('/api/patient/dashboard')
      .set('Authorization', `Bearer ${patientToken}`);
    expect(dashRes.status).toBe(200);
    expect(dashRes.body.familyDependents.length).toBe(2);

    const childRel = dashRes.body.familyDependents.find(
      (f: any) => f.relationshipType === 'CHILD'
    );
    const seniorRel = dashRes.body.familyDependents.find(
      (f: any) => f.relationshipType === 'OLD'
    );
    childAyaanId = childRel.dependent.id;
    seniorKarimId = seniorRel.dependent.id;

    // Maintainer full proxy access to Child Ayaan's Vault
    const childVaultRes = await request(app)
      .get('/api/patient/vault')
      .set('Authorization', `Bearer ${patientToken}`)
      .set('x-acting-patient-id', childAyaanId);
    expect(childVaultRes.status).toBe(200);
    expect(childVaultRes.body.documents.length).toBeGreaterThan(0);

    // Generate 2-hour QR code for Tanvir Ahmed's Vault
    const qrGenRes = await request(app)
      .post('/api/patient/vault/qr-generate')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ selectAll: true });
    expect(qrGenRes.status).toBe(201);
    expect(qrGenRes.body.session.shortCode).toMatch(/^QR-/);
    expect(qrGenRes.body.qrDataUrl).toContain('data:image/png;base64,');
    generatedQrSessionId = qrGenRes.body.session.id;
    generatedQrShortCode = qrGenRes.body.session.shortCode;
  });

  it('08. Doctor QR Scanning stacks most recent patient at top, enforces strict QR-only prescription rule, and locks prescriptions as immutable', async () => {
    const docLogin = await request(app).post('/api/auth/login').send({
      identifier: 'dr.rahman@demo.bd',
      password: 'Demo@2026',
    });
    expect(docLogin.status).toBe(200);
    doctorToken = docLogin.body.token;
    drRahmanId = docLogin.body.user.doctorProfile.id;

    // 1. Strict Rule 7a: Doctor attempting to issue a prescription WITHOUT qrSessionId must be rejected (403)
    const noQrRxRes = await request(app)
      .post('/api/doctor/prescriptions')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        diagnosis: 'Unauthorized Prescription Attempt',
        medications: [{ name: 'Tab. Test', dosage: '1+0+1', duration: '5d' }],
      });
    expect(noQrRxRes.status).toBe(403);
    expect(noQrRxRes.body.code).toBe('QR_SCAN_REQUIRED');

    // 2. Doctor scans the newly generated QR code
    const scanRes = await request(app)
      .post('/api/doctor/qr/scan')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ qrInput: generatedQrShortCode });
    expect(scanRes.status).toBe(200);
    expect(scanRes.body.session.status).toBe('SCANNED_ACTIVE');

    // 3. Check Doctor's Active QR Queue: the newly scanned session MUST be at index 0 (the top of the stack!)
    const queueRes = await request(app)
      .get('/api/doctor/qr/queue')
      .set('Authorization', `Bearer ${doctorToken}`);
    expect(queueRes.status).toBe(200);
    expect(queueRes.body.queue.length).toBeGreaterThanOrEqual(2);
    expect(queueRes.body.queue[0].id).toBe(generatedQrSessionId);

    // 4. Issue immutable prescription using the active scanned QR session
    const rxRes = await request(app)
      .post('/api/doctor/prescriptions')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        qrSessionId: generatedQrSessionId,
        diagnosis: 'Controlled Hypertension — Follow-up Review',
        chiefComplaints: 'Feeling well, BP stable',
        medications: [
          {
            name: 'Tab. Amlodipine 5mg',
            dosage: '0 + 0 + 1',
            duration: '30 Days',
            instruction: 'Continue after dinner',
          },
        ],
        advice: 'Continue low salt diet.',
      });
    expect(rxRes.status).toBe(201);
    expect(rxRes.body.prescription.isImmutable).toBe(true);
    issuedPrescriptionId = rxRes.body.prescription.id;

    // 5. Verify prescription is permanently immutable (cannot be edited after sending)
    const mutateAttempt = await request(app)
      .patch(`/api/doctor/prescriptions/${issuedPrescriptionId}`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ diagnosis: 'Modified Diagnosis' });
    expect(mutateAttempt.status).toBe(403);
    expect(mutateAttempt.body.code).toBe('PRESCRIPTION_IMMUTABLE');

    // 6. Patient revokes QR access -> Doctor can no longer issue prescriptions on that session
    const revokeRes = await request(app)
      .post(`/api/patient/vault/qr-sessions/${generatedQrSessionId}/revoke`)
      .set('Authorization', `Bearer ${patientToken}`);
    expect(revokeRes.status).toBe(200);

    const rxAfterRevoke = await request(app)
      .post('/api/doctor/prescriptions')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        qrSessionId: generatedQrSessionId,
        diagnosis: 'Attempt after patient revoked QR',
        medications: [{ name: 'Tab. X', dosage: '1+0+0', duration: '3d' }],
      });
    expect(rxAfterRevoke.status).toBe(403);
  });

  it('09. Workspace Dynamic RBAC, Multi-Role Combination, Admin Boundary, Immutable Removed Staff Logs, and Ownership Transfer work strictly', async () => {
    // Login as Evercare Owner, Admin, Multi-Role Staff (Receptionist + Billing Officer), and Lab Tech
    const [ownerLogin, adminLogin, multiLogin, labLogin] = await Promise.all([
      request(app)
        .post('/api/auth/login')
        .send({ identifier: 'owner.evercare@demo.bd', password: 'Demo@2026' }),
      request(app)
        .post('/api/auth/login')
        .send({ identifier: 'admin.evercare@demo.bd', password: 'Demo@2026' }),
      request(app)
        .post('/api/auth/login')
        .send({ identifier: 'staff.multi@demo.bd', password: 'Demo@2026' }),
      request(app)
        .post('/api/auth/login')
        .send({ identifier: 'lab.evercare@demo.bd', password: 'Demo@2026' }),
    ]);

    ownerToken = ownerLogin.body.token;
    adminToken = adminLogin.body.token;
    multiStaffToken = multiLogin.body.token;
    labStaffToken = labLogin.body.token;
    evercareWorkspaceId =
      ownerLogin.body.user.workspaces.find(
        (w: any) => w.workspaceCode === 'WSP-2026-9001'
      )?.workspaceId || ownerLogin.body.user.workspaces[0].workspaceId;

    // 1. Verify Multi-Role Staff has COMBINED permissions of Receptionist + Billing Officer
    const multiWs = multiLogin.body.user.workspaces[0];
    expect(multiWs.roleNames).toContain('Receptionist');
    expect(multiWs.roleNames).toContain('Billing Officer');
    expect(multiWs.combinedPermissions).toContain('appointments.manage');
    expect(multiWs.combinedPermissions).toContain('billing.create');
    expect(multiWs.combinedPermissions).not.toContain('roles.manage');

    // 2. Multi-Role Staff can create a Billing Invoice ('billing.create')
    const billRes = await request(app)
      .post(`/api/workspaces/${evercareWorkspaceId}/billing`)
      .set('Authorization', `Bearer ${multiStaffToken}`)
      .send({
        patientIdentifier: 'PAT-2026-100001',
        title: 'Outpatient Consultation & ECG Invoice',
        items: [{ description: 'Cardiology Consultation', qty: 1, amount: 1500 }],
        paymentStatus: 'PAID',
      });
    expect(billRes.status).toBe(201);

    // 3. Multi-Role Staff is blocked from creating a Dynamic Role (missing 'roles.manage')
    const blockedRoleRes = await request(app)
      .post(`/api/workspaces/${evercareWorkspaceId}/roles`)
      .set('Authorization', `Bearer ${multiStaffToken}`)
      .send({
        name: 'Unauthorized Role',
        permissions: ['staff.view'],
      });
    expect(blockedRoleRes.status).toBe(403);

    // 4. Lab Technician uploads a Diagnostic Lab Report ('reports.upload')
    const labUploadRes = await request(app)
      .post(`/api/workspaces/${evercareWorkspaceId}/reports`)
      .set('Authorization', `Bearer ${labStaffToken}`)
      .send({
        patientIdentifier: 'PAT-2026-100001',
        title: 'High-Sensitivity Troponin-I & Electrolyte Panel',
        testCategory: 'Cardiac Biomarkers',
        parameters: [
          {
            name: 'hs-Troponin-I',
            result: '4.1 ng/L',
            referenceRange: '< 19.0 ng/L',
            flag: 'NORMAL',
          },
        ],
        conclusion: 'Negative for acute myocardial injury.',
      });
    expect(labUploadRes.status).toBe(201);

    // 5. Admin Governance Boundary: Admin CANNOT remove Owner or promote/remove another Admin
    const staffListRes = await request(app)
      .get(`/api/workspaces/${evercareWorkspaceId}/staff`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(staffListRes.status).toBe(200);

    const ownerMember = staffListRes.body.staff.find((s: any) => s.isOwner);
    const adminMember = staffListRes.body.staff.find(
      (s: any) => s.isAdmin && !s.isOwner
    );

    const removeOwnerAttempt = await request(app)
      .delete(`/api/workspaces/${evercareWorkspaceId}/staff/${ownerMember.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(removeOwnerAttempt.status).toBe(403);
    expect(removeOwnerAttempt.body.code).toBe('CANNOT_REMOVE_OWNER');

    // 6. Verify Immutable Audit Logs include historical performance logs of Removed Staff (Zahidul Karim)
    const auditRes = await request(app)
      .get(`/api/workspaces/${evercareWorkspaceId}/audit-logs`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(auditRes.status).toBe(200);
    const removedStaffSummary = auditRes.body.staffPerformanceSummary.find(
      (s: any) => s.status === 'REMOVED'
    );
    expect(removedStaffSummary).toBeDefined();
    expect(removedStaffSummary.metrics.totalLoggedActions).toBeGreaterThanOrEqual(2);

    // 7. Single Primary Owner can Transfer Ownership to Admin and Admin can Transfer it back
    const transferToAdmin = await request(app)
      .post(`/api/workspaces/${evercareWorkspaceId}/transfer-ownership`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        targetMemberId: adminMember.id,
        password: 'Demo@2026',
      });
    expect(transferToAdmin.status).toBe(200);

    // Transfer back to original Owner
    const transferBack = await request(app)
      .post(`/api/workspaces/${evercareWorkspaceId}/transfer-ownership`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        targetMemberId: ownerMember.id,
        password: 'Demo@2026',
      });
    expect(transferBack.status).toBe(200);
  });

  it('10. Invitation & Acceptance Audit Logs, Doctor Undo Revoke, Independent Appointments & DGHS Notifications', async () => {
    // 1. Workspace Owner invites Staff -> response returns auditLog ('STAFF_INVITED')
    const rolesRes = await request(app)
      .get(`/api/workspaces/${evercareWorkspaceId}/context`)
      .set('Authorization', `Bearer ${ownerToken}`);
    const recepRole = rolesRes.body.roles.find(
      (r: any) => r.name === 'Receptionist'
    );

    const inviteStaffRes = await request(app)
      .post(`/api/workspaces/${evercareWorkspaceId}/staff/invite`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        patientIdentifier: 'newpatient.e2e@demo.bd',
        roleIds: [recepRole.id],
        staffTitle: 'Day Shift Receptionist',
      });
    expect(inviteStaffRes.status).toBe(201);
    expect(inviteStaffRes.body.auditLog).toBeDefined();
    expect(inviteStaffRes.body.auditLog.action).toBe('STAFF_INVITED');

    // Staff logs in & accepts -> response returns second auditLog ('STAFF_INVITATION_ACCEPTED')
    const newPatLogin = await request(app).post('/api/auth/login').send({
      identifier: 'newpatient.e2e@demo.bd',
      password: 'Demo@2026',
    });
    const newPatToken = newPatLogin.body.token;
    const acceptStaffRes = await request(app)
      .patch(
        `/api/patient/staff-invitations/${inviteStaffRes.body.member.id}/respond`
      )
      .set('Authorization', `Bearer ${newPatToken}`)
      .send({ action: 'ACCEPT' });
    expect(acceptStaffRes.status).toBe(200);
    expect(acceptStaffRes.body.auditLog).toBeDefined();
    expect(acceptStaffRes.body.auditLog.action).toBe(
      'STAFF_INVITATION_ACCEPTED'
    );

    // 2. Workspace Owner invites Doctor -> response returns auditLog ('DOCTOR_INVITED')
    const nusratLogin = await request(app).post('/api/auth/login').send({
      identifier: 'dr.nusrat@demo.bd',
      password: 'Demo@2026',
    });
    const nusratToken = nusratLogin.body.token;
    const nusratDocCode = nusratLogin.body.user.doctorProfile.doctorIdCode;

    // Invite Dr. Nusrat to Square Clinic (WSP-2026-9003, also owned by evercareOwner)
    const squareWs = rolesRes.body; // find Square workspace from owner login
    const ownerMe = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${ownerToken}`);
    const squareWorkspaceId = ownerMe.body.user.workspaces.find(
      (w: any) => w.workspaceCode === 'WSP-2026-9003'
    ).workspaceId;

    const inviteDocRes = await request(app)
      .post(`/api/workspaces/${squareWorkspaceId}/doctors/invite`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        doctorIdentifier: nusratDocCode,
        consultationFee: 1100,
        schedule: 'Tue, Thu: 4:00 PM - 7:00 PM',
      });
    expect(inviteDocRes.status).toBe(201);
    expect(inviteDocRes.body.auditLog).toBeDefined();
    expect(inviteDocRes.body.auditLog.action).toBe('DOCTOR_INVITED');
    void squareWs;

    // Doctor accepts -> response returns auditLog ('DOCTOR_AFFILIATION_ACCEPTED')
    const affId = inviteDocRes.body.affiliation.id;
    const acceptDocRes = await request(app)
      .patch(`/api/doctor/affiliations/${affId}/respond`)
      .set('Authorization', `Bearer ${nusratToken}`)
      .send({ status: 'ACTIVE' });
    expect(acceptDocRes.status).toBe(200);
    expect(acceptDocRes.body.auditLog).toBeDefined();
    expect(acceptDocRes.body.auditLog.action).toBe(
      'DOCTOR_AFFILIATION_ACCEPTED'
    );

    // Doctor revokes -> status REVOKED, then Undoes Revoke -> restored to ACTIVE
    const revokeDocRes = await request(app)
      .patch(`/api/doctor/affiliations/${affId}/respond`)
      .set('Authorization', `Bearer ${nusratToken}`)
      .send({ status: 'REVOKED' });
    expect(revokeDocRes.status).toBe(200);
    expect(revokeDocRes.body.affiliation.status).toBe('REVOKED');
    expect(revokeDocRes.body.auditLog.action).toBe(
      'DOCTOR_AFFILIATION_REVOKED'
    );

    const undoRevokeRes = await request(app)
      .patch(`/api/doctor/affiliations/${affId}/respond`)
      .set('Authorization', `Bearer ${nusratToken}`)
      .send({ status: 'ACTIVE' });
    expect(undoRevokeRes.status).toBe(200);
    expect(undoRevokeRes.body.affiliation.status).toBe('ACTIVE');
    expect(undoRevokeRes.body.auditLog.action).toBe(
      'DOCTOR_AFFILIATION_RESTORED'
    );

    // 3. Patient books appointment at Affiliated Hospital AND Independent Chamber
    // Verify Doctor Directory exposes configured availableSlots and independentSlots
    const dirDocsRes = await request(app)
      .get('/api/patient/doctors')
      .set('Authorization', `Bearer ${patientToken}`);
    expect(dirDocsRes.status).toBe(200);
    const rahmanDirDoc = dirDocsRes.body.doctors.find(
      (d: any) => d.id === drRahmanId
    );
    expect(rahmanDirDoc).toBeDefined();
    expect(Array.isArray(rahmanDirDoc.independentSlots)).toBe(true);
    expect(rahmanDirDoc.independentSlots).toContain('07:00 PM');
    expect(Array.isArray(rahmanDirDoc.affiliations[0].availableSlots)).toBe(true);
    expect(rahmanDirDoc.affiliations[0].availableSlots).toContain('06:00 PM');

    // Attempting to request an appointment with an unconfigured timeSlot must be rejected (400 SLOT_NOT_AVAILABLE)
    const invalidSlotApptRes = await request(app)
      .post('/api/patient/appointments')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        doctorId: drRahmanId,
        workspaceId: evercareWorkspaceId,
        appointmentDate: '2026-11-20',
        timeSlot: '03:15 AM',
        reason: 'Invalid unconfigured time slot attempt',
      });
    expect(invalidSlotApptRes.status).toBe(400);
    expect(invalidSlotApptRes.body.code).toBe('SLOT_NOT_AVAILABLE');

    const hospApptRes = await request(app)
      .post('/api/patient/appointments')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        doctorId: drRahmanId,
        workspaceId: evercareWorkspaceId,
        appointmentDate: '2026-11-20',
        timeSlot: '06:00 PM',
        reason: 'Follow-up Cardiology Review',
      });
    expect(hospApptRes.status).toBe(201);

    const indepApptRes = await request(app)
      .post('/api/patient/appointments')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        doctorId: drRahmanId,
        workspaceId: 'INDEPENDENT_CHAMBER',
        appointmentDate: '2026-11-22',
        timeSlot: '07:00 PM',
        reason: 'Personal Chamber Consultation',
      });
    expect(indepApptRes.status).toBe(201);
    expect(indepApptRes.body.appointment.workspaceId).toBeNull();

    // Cancel the Independent Chamber appointment request
    const cancelApptRes = await request(app)
      .patch(`/api/patient/appointments/${indepApptRes.body.appointment.id}/cancel`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ reason: 'Schedule conflict' });
    expect(cancelApptRes.status).toBe(200);
    expect(cancelApptRes.body.appointment.status).toBe('CANCELLED');

    // Self-upload external clinical record to Patient Vault & search by keyword
    const selfUploadRes = await request(app)
      .post('/api/patient/vault/self-upload')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        type: 'LAB_REPORT',
        title: 'External Fasting Lipid Profile Report',
        summary: 'Total Cholesterol 182 mg/dL',
        doctorNameSnapshot: 'Dr. Mahmudul Hasan',
        workspaceNameSnapshot: 'Popular Diagnostic Centre',
        structuredData: {
          parameters: [
            {
              name: 'Total Cholesterol',
              result: '182 mg/dL',
              referenceRange: '< 200 mg/dL',
              flag: 'NORMAL',
            },
          ],
        },
      });
    expect(selfUploadRes.status).toBe(201);
    expect(selfUploadRes.body.document.documentCode).toMatch(/^LAB-EXT-/);

    const searchVaultRes = await request(app)
      .get('/api/patient/vault?search=Lipid')
      .set('Authorization', `Bearer ${patientToken}`);
    expect(searchVaultRes.status).toBe(200);
    expect(searchVaultRes.body.documents.length).toBeGreaterThanOrEqual(1);

    // Update patient profile with clinical demographics & emergency contact
    const profilePatchRes = await request(app)
      .patch('/api/patient/profile')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        gender: 'Male',
        dateOfBirth: '1988-05-14',
        bloodGroup: 'O+',
        emergencyContact: 'Nusrat Jahan (Spouse) — +8801711223344',
      });
    expect(profilePatchRes.status).toBe(200);
    expect(profilePatchRes.body.patient.emergencyContact).toContain(
      'Nusrat Jahan'
    );

    // Verify enriched Patient Dashboard includes vaultSummary, activeMedications, and recentActivityLogs
    const enrichedDashRes = await request(app)
      .get('/api/patient/dashboard')
      .set('Authorization', `Bearer ${patientToken}`);
    expect(enrichedDashRes.status).toBe(200);
    expect(enrichedDashRes.body.vaultSummary).toBeDefined();
    expect(enrichedDashRes.body.vaultSummary.total).toBeGreaterThan(0);
    expect(
      Array.isArray(enrichedDashRes.body.vaultSummary.activeMedications)
    ).toBe(true);
    expect(Array.isArray(enrichedDashRes.body.recentActivityLogs)).toBe(true);
    expect(enrichedDashRes.body.recentActivityLogs.length).toBeGreaterThan(0);

    // 4. Central Registry Overview & Notifications
    const dghsOverview = await request(app)
      .get('/api/central-registry/overview')
      .set('Authorization', `Bearer ${dghsToken}`);
    expect(dghsOverview.status).toBe(200);
    expect(dghsOverview.body.ecosystemConnections).toBeDefined();
    expect(
      dghsOverview.body.ecosystemConnections.hospitalDoctorMatrix.length
    ).toBeGreaterThan(0);
    expect(
      dghsOverview.body.ecosystemConnections.patientDoctorMatrix.length
    ).toBeGreaterThan(0);

    const dghsNotifRes = await request(app)
      .get('/api/notifications?persona=CENTRAL_REGISTRY')
      .set('Authorization', `Bearer ${dghsToken}`);
    expect(dghsNotifRes.status).toBe(200);
    expect(dghsNotifRes.body.notifications.length).toBeGreaterThan(0);

    const markAllDghs = await request(app)
      .post('/api/notifications/read-all')
      .set('Authorization', `Bearer ${dghsToken}`)
      .send({ persona: 'CENTRAL_REGISTRY' });
    expect(markAllDghs.status).toBe(200);
  });
});
