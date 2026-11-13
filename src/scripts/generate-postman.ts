import fs from 'fs';
import path from 'path';

const POSTMAN_DIR = path.resolve(__dirname, '../../postman');

function buildItem(params: {
  name: string;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  pathSegments: string[];
  query?: { key: string; value: string; description?: string }[];
  body?: any;
  tokenVar?: string;
  headers?: { key: string; value: string }[];
  description: string;
  testScript?: string[];
}) {
  const {
    name,
    method,
    pathSegments,
    query = [],
    body,
    tokenVar = 'patientToken',
    headers = [],
    description,
    testScript = [
      'pm.test("Status code is expected", function () {',
      '    pm.expect(pm.response.code).to.be.oneOf([200, 201, 403]);',
      '});',
      'pm.test("Response is valid JSON", function () {',
      '    pm.response.to.be.json;',
      '});',
    ],
  } = params;

  const rawQuery =
    query.length > 0
      ? '?' + query.map((q) => `${q.key}=${encodeURIComponent(q.value)}`).join('&')
      : '';

  return {
    name,
    event: [
      {
        listen: 'test',
        script: {
          type: 'text/javascript',
          exec: testScript,
        },
      },
    ],
    request: {
      method,
      header: [
        { key: 'Content-Type', value: 'application/json' },
        ...(tokenVar
          ? [{ key: 'Authorization', value: `Bearer {{${tokenVar}}}` }]
          : []),
        ...headers,
      ],
      ...(body
        ? {
            body: {
              mode: 'raw',
              raw: JSON.stringify(body, null, 2),
              options: { raw: { language: 'json' } },
            },
          }
        : {}),
      url: {
        raw: `{{baseUrl}}/${pathSegments.join('/')}${rawQuery}`,
        host: ['{{baseUrl}}'],
        path: pathSegments,
        query,
      },
      description,
    },
  };
}

export function generatePostmanFiles() {
  if (!fs.existsSync(POSTMAN_DIR)) {
    fs.mkdirSync(POSTMAN_DIR, { recursive: true });
  }

  const collection = {
    info: {
      _postman_id: '5fce615c-ab97-4f38-8048-2a1d54fd51ac',
      name: 'Unified Health Platform — Complete API Suite',
      description:
        'Comprehensive API Collection for the Unified Health Platform (Central Registry DGHS, Patient Vault & 2h QR Sharing, Doctor QR Stack & Immutable Prescriptions, Hospital Dynamic 24-Permission RBAC, Family Maintainer Proxy, and Notifications).',
      schema:
        'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: [
      {
        name: '01. System Health & Public Showcase',
        item: [
          buildItem({
            name: 'Health Check',
            method: 'GET',
            pathSegments: ['api', 'health'],
            tokenVar: '',
            description: 'Checks API server and PostgreSQL database connectivity.',
          }),
          buildItem({
            name: 'Public Showcase (Packages, Hospitals & Doctors)',
            method: 'GET',
            pathSegments: ['api', 'public', 'showcase'],
            tokenVar: '',
            description:
              'Returns featured hospital packages (e.g. Full Body Checkup 10,000 Tk), approved hospitals, and doctors.',
          }),
        ],
      },
      {
        name: '02. Authentication & Multi-Persona Onboarding',
        item: [
          buildItem({
            name: 'Login as Central Registry (DGHS via .env)',
            method: 'POST',
            pathSegments: ['api', 'auth', 'login'],
            tokenVar: '',
            body: {
              identifier: 'dghs@health.gov.bd',
              password: 'DGHS@Admin2026!',
            },
            description:
              'Authenticates Central Registry (DGHS) using credentials configured in .env.',
            testScript: [
              'const json = pm.response.json();',
              'pm.test("DGHS Login succeeds", () => pm.expect(pm.response.code).to.eql(200));',
              'if (json.token) pm.environment.set("dghsToken", json.token);',
            ],
          }),
          buildItem({
            name: 'Login as Patient (Tanvir Ahmed - Family Maintainer)',
            method: 'POST',
            pathSegments: ['api', 'auth', 'login'],
            tokenVar: '',
            body: {
              identifier: 'patient@demo.bd',
              password: 'Demo@2026',
            },
            description: 'Authenticates Patient via email/phone and password.',
            testScript: [
              'const json = pm.response.json();',
              'pm.test("Patient Login succeeds", () => pm.expect(pm.response.code).to.eql(200));',
              'if (json.token) pm.environment.set("patientToken", json.token);',
            ],
          }),
          buildItem({
            name: 'Login as Doctor (Prof. Dr. Mahbubur Rahman)',
            method: 'POST',
            pathSegments: ['api', 'auth', 'login'],
            tokenVar: '',
            body: {
              identifier: 'dr.rahman@demo.bd',
              password: 'Demo@2026',
            },
            description:
              'Authenticates Doctor and returns both Doctor profile and mandatory base Patient account for navbar switching.',
            testScript: [
              'const json = pm.response.json();',
              'pm.test("Doctor Login succeeds", () => pm.expect(pm.response.code).to.eql(200));',
              'if (json.token) pm.environment.set("doctorToken", json.token);',
            ],
          }),
          buildItem({
            name: 'Login as Hospital Single Owner (Evercare Hospital)',
            method: 'POST',
            pathSegments: ['api', 'auth', 'login'],
            tokenVar: '',
            body: {
              identifier: 'owner.evercare@demo.bd',
              password: 'Demo@2026',
            },
            description:
              'Authenticates Workspace Single Primary Owner with full 24 permissions.',
            testScript: [
              'const json = pm.response.json();',
              'pm.test("Owner Login succeeds", () => pm.expect(pm.response.code).to.eql(200));',
              'if (json.token) pm.environment.set("ownerToken", json.token);',
              'if (json.user && json.user.workspaces && json.user.workspaces[0]) {',
              '    pm.environment.set("workspaceId", json.user.workspaces[0].workspaceId);',
              '}',
            ],
          }),
          buildItem({
            name: 'Register New Patient (With Resend SMTP OTP)',
            method: 'POST',
            pathSegments: ['api', 'auth', 'patient', 'register'],
            tokenVar: '',
            body: {
              name: 'Nadia Rahman',
              email: 'nadia.patient@demo.bd',
              phone: '+8801799887766',
              password: 'Demo@2026',
              accountType: 'NORMAL',
            },
            description:
              'Registers a new Patient account, generates unique_id, and sends 6-digit OTP via Resend SMTP.',
          }),
          buildItem({
            name: 'Verify Patient OTP',
            method: 'POST',
            pathSegments: ['api', 'auth', 'patient', 'verify-otp'],
            tokenVar: '',
            body: {
              identifier: 'nadia.patient@demo.bd',
              otpCode: '{{lastOtpCode}}',
            },
            description: 'Verifies the 6-digit OTP and activates the Patient account.',
          }),
          buildItem({
            name: 'Register New Doctor (Auto-Creates Linked Patient Account)',
            method: 'POST',
            pathSegments: ['api', 'auth', 'doctor', 'register'],
            tokenVar: '',
            body: {
              name: 'Dr. Imran Kabir',
              email: 'dr.imran@demo.bd',
              phone: '+8801788112233',
              password: 'Demo@2026',
              doctorLicense: 'BMDC-A-91234',
              nationalId: '1984269489123',
              specialty: 'Pediatrics',
              degrees: ['MBBS (DMC)', 'FCPS (Pediatrics)'],
              area: 'Uttara, Dhaka',
              defaultConsultationFee: 1000,
            },
            description:
              'Submits Doctor registration to Central Registry (DGHS) and automatically creates the linked base Patient account.',
          }),
          buildItem({
            name: 'Register New Hospital / Workspace (Option A: Auto-Creates Owner Patient Account)',
            method: 'POST',
            pathSegments: ['api', 'auth', 'workspace', 'register'],
            tokenVar: '',
            body: {
              workspaceName: 'United Specialized Diagnostic & Hospital',
              type: 'HOSPITAL',
              registrationLicense: 'DGHS-HOSP-2026-777',
              workspaceEmail: 'contact@united-demo.bd',
              workspacePhone: '+8801766554433',
              address: 'Plot 15, Road 71, Gulshan, Dhaka-1212',
              area: 'Gulshan, Dhaka',
              ownerName: 'Farhan Ahmed',
              ownerEmail: 'owner.united@demo.bd',
              ownerPhone: '+8801766554433',
              ownerPassword: 'Demo@2026',
              ownerNationalId: '1976269487777',
            },
            description:
              'Registers a new Hospital/Workspace, auto-creates the Single Primary Owner Patient account, and seeds dynamic RBAC roles.',
          }),
          buildItem({
            name: 'Get Current Authenticated User Context (/api/auth/me)',
            method: 'GET',
            pathSegments: ['api', 'auth', 'me'],
            tokenVar: 'patientToken',
            description:
              'Returns full user context including Patient, Doctor, Workspaces, Combined Permissions, and Family Dependents.',
          }),
        ],
      },
      {
        name: '03. Central Registry (DGHS Governance)',
        item: [
          buildItem({
            name: 'DGHS Overview Dashboard Metrics',
            method: 'GET',
            pathSegments: ['api', 'central-registry', 'overview'],
            tokenVar: 'dghsToken',
            description:
              'Returns system-wide KPIs for Patients, Doctors, Workspaces, and Clinical Vault activity.',
          }),
          buildItem({
            name: 'List All Patients (Search & Filter)',
            method: 'GET',
            pathSegments: ['api', 'central-registry', 'patients'],
            tokenVar: 'dghsToken',
            description:
              'Lists all patients with family maintainer links, vault counts, and status.',
          }),
          buildItem({
            name: 'Inspect Patient Vault, Activities, Family & Doctor Connections',
            method: 'GET',
            pathSegments: [
              'api',
              'central-registry',
              'patients',
              '{{samplePatientId}}',
              'inspect',
            ],
            tokenVar: 'dghsToken',
            description:
              'Deep inspection of a patient: Report/Prescription Vault, Activity Logs, Child/Old Family Links, and Doctor Consultation Connections.',
          }),
          buildItem({
            name: 'Disable / Enable Patient Account',
            method: 'PATCH',
            pathSegments: [
              'api',
              'central-registry',
              'patients',
              '{{samplePatientId}}',
              'status',
            ],
            tokenVar: 'dghsToken',
            body: {
              status: 'ACTIVE',
              reason: 'DGHS compliance check passed',
            },
            description: 'Enables or disables a Patient account.',
          }),
          buildItem({
            name: 'List All Doctors (Filter by APPROVED, PENDING, DECLINED, DISABLED)',
            method: 'GET',
            pathSegments: ['api', 'central-registry', 'doctors'],
            query: [{ key: 'approvalStatus', value: 'APPROVED' }],
            tokenVar: 'dghsToken',
            description:
              'Lists doctors filtered by approval status, including hospital affiliations.',
          }),
          buildItem({
            name: 'Inspect Doctor (Hospital Connections, Multi-Hospital Fees & Connected Patients)',
            method: 'GET',
            pathSegments: [
              'api',
              'central-registry',
              'doctors',
              '{{sampleDoctorId}}',
              'inspect',
            ],
            tokenVar: 'dghsToken',
            description:
              'Inspects a Doctor: BMDC license, multiple consultation fees across hospitals, and connected patients.',
          }),
          buildItem({
            name: 'Approve / Decline / Disable Doctor Registration',
            method: 'PATCH',
            pathSegments: [
              'api',
              'central-registry',
              'doctors',
              '{{sampleDoctorId}}',
              'status',
            ],
            tokenVar: 'dghsToken',
            body: {
              approvalStatus: 'APPROVED',
              dghsNotes: 'Cross-checked BMDC license and National ID.',
            },
            description:
              'Approves, declines, disables, or enables a Doctor registration.',
          }),
          buildItem({
            name: 'List All Hospitals / Workspaces (Filter by Status & Type)',
            method: 'GET',
            pathSegments: ['api', 'central-registry', 'workspaces'],
            tokenVar: 'dghsToken',
            description:
              'Lists all registered Hospitals, Clinics, Diagnostic Centers, and Chambers.',
          }),
          buildItem({
            name: 'Inspect Hospital (Members, Dynamic Roles, Doctors, Patients & Packages)',
            method: 'GET',
            pathSegments: [
              'api',
              'central-registry',
              'workspaces',
              '{{workspaceId}}',
              'inspect',
            ],
            tokenVar: 'dghsToken',
            description:
              'Deep inspection of a Hospital: Staff members & dynamic roles, audit logs, affiliated doctors, connected patients, and advertised packages.',
          }),
          buildItem({
            name: 'Approve / Decline / Disable Hospital Workspace',
            method: 'PATCH',
            pathSegments: [
              'api',
              'central-registry',
              'workspaces',
              '{{workspaceId}}',
              'status',
            ],
            tokenVar: 'dghsToken',
            body: {
              approvalStatus: 'APPROVED',
              dghsNotes: 'DGHS hospital inspection verified.',
            },
            description:
              'Approves, declines, disables, or enables a Hospital/Workspace.',
          }),
        ],
      },
      {
        name: '04. Patient Portal (Vault, 2h QR Sharing, Doctor Search, Family Proxy & Packages)',
        item: [
          buildItem({
            name: 'Patient Dashboard (Featured Packages, Vault Summary, Active Medications, Activity Logs, QR, Family)',
            method: 'GET',
            pathSegments: ['api', 'patient', 'dashboard'],
            tokenVar: 'patientToken',
            description:
              'Loads Patient dashboard including featured hospital packages, vault summary & active medications, recent activity logs, upcoming appointments, and family accounts.',
          }),
          buildItem({
            name: 'Patient Report & Prescription Vault (Search & Sort by Doctor, Workspace, or Keyword)',
            method: 'GET',
            pathSegments: ['api', 'patient', 'vault'],
            query: [{ key: 'sortBy', value: 'date_desc' }],
            tokenVar: 'patientToken',
            description:
              'Lists all prescriptions, lab reports, and billing docs in the Patient Vault with keyword search and sorting by Doctor name or Workspace name.',
          }),
          buildItem({
            name: 'Self-Upload Historical or External Clinical Document to Vault',
            method: 'POST',
            pathSegments: ['api', 'patient', 'vault', 'self-upload'],
            tokenVar: 'patientToken',
            body: {
              type: 'LAB_REPORT',
              title: 'External Fasting Lipid Profile Report',
              summary: 'Total Cholesterol 182 mg/dL, LDL 104 mg/dL',
              doctorNameSnapshot: 'Dr. Mahmudul Hasan',
              workspaceNameSnapshot: 'Popular Diagnostic Centre',
              structuredData: {
                testCategory: 'Lipid Panel',
                parameters: [
                  {
                    name: 'Total Cholesterol',
                    result: '182 mg/dL',
                    referenceRange: '< 200 mg/dL',
                    flag: 'NORMAL',
                  },
                ],
                conclusion: 'Within normal lipid reference limits.',
              },
            },
            description:
              'Allows a patient or proxy maintainer to log an external prescription, lab report, or invoice into their Vault.',
          }),
          buildItem({
            name: 'Generate 2-Hour Temporary QR Code for Selected Vault Docs',
            method: 'POST',
            pathSegments: ['api', 'patient', 'vault', 'qr-generate'],
            tokenVar: 'patientToken',
            body: {
              selectAll: true,
              documentIds: [],
            },
            description:
              'Generates a 2-hour temporary QR code (plus 6-character pairing code) for a Doctor to scan.',
          }),
          buildItem({
            name: 'List Active & Past QR Sessions',
            method: 'GET',
            pathSegments: ['api', 'patient', 'vault', 'qr-sessions'],
            tokenVar: 'patientToken',
            description:
              'Lists all QR share sessions and their remaining time or scan status.',
          }),
          buildItem({
            name: 'Revoke Doctor Access to Shared QR Session',
            method: 'POST',
            pathSegments: [
              'api',
              'patient',
              'vault',
              'qr-sessions',
              '{{qrSessionId}}',
              'revoke',
            ],
            tokenVar: 'patientToken',
            description:
              'Immediately revokes a shared QR code so the Doctor can no longer view the patient documents.',
          }),
          buildItem({
            name: 'Find a Doctor (Search by Name, Workspace, Specialty, Area)',
            method: 'GET',
            pathSegments: ['api', 'patient', 'doctors'],
            query: [
              { key: 'specialty', value: 'Cardiology' },
              { key: 'area', value: 'Dhaka' },
            ],
            tokenVar: 'patientToken',
            description:
              'Searches approved doctors by name, workspace, specialty (Orthopedics, Gynecology, Cardiology), and area.',
          }),
          buildItem({
            name: 'Apply for Appointment with Doctor at Chosen Workspace',
            method: 'POST',
            pathSegments: ['api', 'patient', 'appointments'],
            tokenVar: 'patientToken',
            body: {
              doctorId: '{{sampleDoctorId}}',
              workspaceId: '{{workspaceId}}',
              appointmentDate: '2026-11-20',
              timeSlot: '07:00 PM',
              reason: 'Cardiac checkup and ECG review',
            },
            description:
              'Books an appointment at a specific affiliated workspace (confirmed by Workspace Staff).',
          }),
          buildItem({
            name: 'Cancel Pending or Approved Appointment',
            method: 'PATCH',
            pathSegments: [
              'api',
              'patient',
              'appointments',
              '{{appointmentId}}',
              'cancel',
            ],
            tokenVar: 'patientToken',
            body: {
              reason: 'Schedule conflict — will rebook next week',
            },
            description:
              'Cancels a pending or approved patient appointment and notifies the hospital or independent doctor.',
          }),
          buildItem({
            name: 'Search & Sort Registered Hospitals & Packages',
            method: 'GET',
            pathSegments: ['api', 'patient', 'workspaces'],
            query: [{ key: 'sortBy', value: 'name_asc' }],
            tokenVar: 'patientToken',
            description:
              'Returns top promotional package cards and searchable/sortable hospital directory.',
          }),
          buildItem({
            name: 'Update Patient Profile (Demographics, Emergency Contact, Multiple Emails/Numbers, Avatar, Password)',
            method: 'PATCH',
            pathSegments: ['api', 'patient', 'profile'],
            tokenVar: 'patientToken',
            body: {
              name: 'Tanvir Ahmed',
              gender: 'Male',
              dateOfBirth: '1988-05-14',
              bloodGroup: 'O+',
              emergencyContact: 'Nusrat Jahan (Spouse) — +8801711223344',
              secondaryEmails: ['tanvir.personal@gmail.com', 'tanvir.work@bd.org'],
              secondaryPhones: ['+8801811000001', '+8801911000002'],
            },
            description:
              'Updates patient profile including gender, date of birth, blood group, emergency contact, and secondary emails/phones.',
          }),
          buildItem({
            name: 'Family Management — View Child & Senior Dependents',
            method: 'GET',
            pathSegments: ['api', 'patient', 'family'],
            tokenVar: 'patientToken',
            description:
              'Returns Child and Senior (Old) family accounts linked to this Maintainer.',
          }),
          buildItem({
            name: 'Family Management — Invite Child / Old Account or Maintainer',
            method: 'POST',
            pathSegments: ['api', 'patient', 'family', 'invite'],
            tokenVar: 'patientToken',
            body: {
              targetIdentifier: 'PAT-2026-100002',
              direction: 'AS_MAINTAINER',
              relationshipType: 'CHILD',
              relationshipLabel: 'Son',
            },
            description:
              'Establishes a family maintainer invitation with a Child or Senior patient account.',
          }),
          buildItem({
            name: 'Family Maintainer Proxy — Access Dependent Vault via x-acting-patient-id',
            method: 'GET',
            pathSegments: ['api', 'patient', 'vault'],
            tokenVar: 'patientToken',
            headers: [
              { key: 'x-acting-patient-id', value: '{{childPatientId}}' },
            ],
            description:
              'Demonstrates full Maintainer proxy access to a connected Child/Senior account.',
          }),
        ],
      },
      {
        name: '05. Doctor Portal (QR Scanner, Stacked Patient Queue, Immutable Prescriptions & Affiliations)',
        item: [
          buildItem({
            name: 'Doctor Dashboard & Active QR Queue Summary',
            method: 'GET',
            pathSegments: ['api', 'doctor', 'dashboard'],
            tokenVar: 'doctorToken',
            description:
              'Returns Doctor profile status, active QR queue stack, and recent prescription history.',
          }),
          buildItem({
            name: 'Scan Patient QR Code (Stacks Most Recent Patient at Top)',
            method: 'POST',
            pathSegments: ['api', 'doctor', 'qr', 'scan'],
            tokenVar: 'doctorToken',
            body: {
              qrInput: 'QR-DEMO99',
              workspaceId: '{{workspaceId}}',
            },
            description:
              'Scans a Patient 2-hour QR code and pushes the patient to the top of the Doctor active consultation queue.',
          }),
          buildItem({
            name: 'Get Stacked Active QR Patient Queue (Ordered by Most Recent Scan)',
            method: 'GET',
            pathSegments: ['api', 'doctor', 'qr', 'queue'],
            tokenVar: 'doctorToken',
            description:
              'Returns all active scanned patients stacked with the most recent scan at the top, including shared Vault documents.',
          }),
          buildItem({
            name: 'Issue Immutable Prescription (Strictly Requires Active Scanned QR Session)',
            method: 'POST',
            pathSegments: ['api', 'doctor', 'prescriptions'],
            tokenVar: 'doctorToken',
            body: {
              qrSessionId: '{{activeQrSessionId}}',
              workspaceId: '{{workspaceId}}',
              diagnosis: 'Seasonal Viral Fever & Pharyngitis',
              chiefComplaints: 'Low-grade fever and sore throat for 3 days',
              medications: [
                {
                  name: 'Tab. Napa 500mg',
                  dosage: '1 + 1 + 1',
                  duration: '5 Days',
                  instruction: 'After meal',
                },
              ],
              advice: 'Warm saline gargle 3 times daily and plenty of fluids.',
              followUpDate: '2026-11-25',
            },
            description:
              'Issues an immutable digital prescription strictly after scanning a Patient QR code, and notifies the Patient.',
          }),
          buildItem({
            name: 'Verify Prescription Immutability (Returns 403 Forbidden)',
            method: 'PATCH',
            pathSegments: [
              'api',
              'doctor',
              'prescriptions',
              '{{prescriptionId}}',
            ],
            tokenVar: 'doctorToken',
            body: {
              diagnosis: 'Attempted modification after sending',
            },
            description:
              'Verifies that issued prescriptions cannot be edited or mutated after sending (returns 403 PRESCRIPTION_IMMUTABLE).',
          }),
          buildItem({
            name: 'Doctor Lifetime Patient & Prescription History (Sort by Workspace or Date)',
            method: 'GET',
            pathSegments: ['api', 'doctor', 'history'],
            query: [{ key: 'sortBy', value: 'date_desc' }],
            tokenVar: 'doctorToken',
            description:
              'Returns lifetime history of patients and prescriptions sent by the Doctor, sortable by workspace or date.',
          }),
          buildItem({
            name: 'Doctor — Send Affiliation Request to Hospital / Workspace',
            method: 'POST',
            pathSegments: ['api', 'doctor', 'affiliations', 'request'],
            tokenVar: 'doctorToken',
            body: {
              workspaceId: '{{workspaceId}}',
              consultationFee: 1500,
              schedule: 'Sun, Tue, Thu: 5:00 PM - 9:00 PM',
            },
            description:
              'Sends a bidirectional affiliation invitation from Doctor to Workspace.',
          }),
          buildItem({
            name: 'Customize Doctor Public Profile & Visibility Toggles',
            method: 'PATCH',
            pathSegments: ['api', 'doctor', 'profile'],
            tokenVar: 'doctorToken',
            body: {
              bio: 'Senior Consultant Interventional Cardiologist.',
              profileVisibility: {
                showDegrees: true,
                showAchievements: true,
                showBio: true,
                showPhoto: true,
                showExperience: true,
                customHeadline: 'Evening Cardiac Chamber Open',
              },
            },
            description:
              'Updates Doctor profile and customizes which fields are visible to patients.',
          }),
        ],
      },
      {
        name: '06. Workspace / Hospital Portal (Dynamic 24-Permission RBAC, Staff, Audit Logs, Lab, Billing & Packages)',
        item: [
          buildItem({
            name: 'Get 24-Permission Catalog',
            method: 'GET',
            pathSegments: ['api', 'workspaces', 'permission-catalog'],
            tokenVar: 'ownerToken',
            description:
              'Returns the 24 granular permissions across 7 operational hospital domains.',
          }),
          buildItem({
            name: 'Get Workspace Context & Member Combined Permissions',
            method: 'GET',
            pathSegments: ['api', 'workspaces', '{{workspaceId}}', 'context'],
            tokenVar: 'ownerToken',
            description:
              'Returns workspace details, member assigned roles, combined permissions, and role-scoped KPIs.',
          }),
          buildItem({
            name: 'Create Custom Dynamic Role (roles.manage)',
            method: 'POST',
            pathSegments: ['api', 'workspaces', '{{workspaceId}}', 'roles'],
            tokenVar: 'ownerToken',
            body: {
              name: 'Senior Radiology & Lab Supervisor',
              description: 'Can view, upload, and verify diagnostic reports.',
              permissions: [
                'patients.lookup',
                'reports.view',
                'reports.upload',
                'reports.verify',
              ],
            },
            description:
              'Creates a custom dynamic role with selected permissions.',
          }),
          buildItem({
            name: 'Invite Staff Member with Multiple Roles (staff.invite)',
            method: 'POST',
            pathSegments: [
              'api',
              'workspaces',
              '{{workspaceId}}',
              'staff',
              'invite',
            ],
            tokenVar: 'ownerToken',
            body: {
              patientIdentifier: 'PAT-2026-100001',
              roleIds: ['{{roleId}}'],
              staffTitle: 'Clinical Coordinator',
              department: 'Outpatient Operations',
            },
            description:
              'Invites a Patient account to join the workspace staff with one or multiple dynamic roles.',
          }),
          buildItem({
            name: 'View Immutable Staff Performance & Audit Logs (Includes Removed Staff)',
            method: 'GET',
            pathSegments: [
              'api',
              'workspaces',
              '{{workspaceId}}',
              'audit-logs',
            ],
            tokenVar: 'ownerToken',
            description:
              'Returns all staff performance counters and immutable historical logs, including removed staff members.',
          }),
          buildItem({
            name: 'Upload Diagnostic Lab Report to Patient Vault (reports.upload)',
            method: 'POST',
            pathSegments: ['api', 'workspaces', '{{workspaceId}}', 'reports'],
            tokenVar: 'ownerToken',
            body: {
              patientIdentifier: 'PAT-2026-100001',
              title: 'Serum Creatinine & Electrolytes Panel',
              testCategory: 'Renal Biochemistry',
              parameters: [
                {
                  name: 'Serum Creatinine',
                  result: '0.92 mg/dL',
                  referenceRange: '0.70 - 1.30 mg/dL',
                  flag: 'NORMAL',
                },
              ],
              conclusion: 'Normal renal function.',
              verified: true,
            },
            description:
              'Uploads a diagnostic report directly to the Patient Vault, logs staff performance, and notifies the Patient.',
          }),
          buildItem({
            name: 'Create Patient Billing Invoice & Dispatch to Vault (billing.create)',
            method: 'POST',
            pathSegments: ['api', 'workspaces', '{{workspaceId}}', 'billing'],
            tokenVar: 'ownerToken',
            body: {
              patientIdentifier: 'PAT-2026-100001',
              title: 'Diagnostic Test Invoice',
              items: [
                {
                  description: 'Serum Creatinine & Electrolytes Panel',
                  qty: 1,
                  amount: 1200,
                },
              ],
              discount: 100,
              paymentStatus: 'PAID',
            },
            description:
              'Creates a billing document in the Patient Vault, logs staff performance, and notifies the Patient.',
          }),
          buildItem({
            name: 'Publish Promotional Health Package (e.g. Full Body Checkup 10,000 Tk)',
            method: 'POST',
            pathSegments: ['api', 'workspaces', '{{workspaceId}}', 'packages'],
            tokenVar: 'ownerToken',
            body: {
              title: 'Full Body Checkup — Executive Package',
              tagline: 'Full Body Checkup Only 10,000 Tk',
              description: 'Complete preventive health checkup.',
              price: 10000,
              originalPrice: 14500,
              includedTests: ['CBC', 'Lipid Profile', 'ECG', 'Echo', 'HbA1c'],
              isFeatured: true,
            },
            description:
              'Publishes a promotional health package advertised on the Patient Dashboard.',
          }),
          buildItem({
            name: 'Workspace Staff Approves Patient Appointment (appointments.manage)',
            method: 'PATCH',
            pathSegments: [
              'api',
              'workspaces',
              '{{workspaceId}}',
              'appointments',
              '{{appointmentId}}',
            ],
            tokenVar: 'ownerToken',
            body: {
              status: 'APPROVED',
              serialNumber: 5,
              notes: 'Confirmed by Workspace Front Desk.',
            },
            description:
              'Approves and schedules a patient appointment request and notifies the patient.',
          }),
          buildItem({
            name: 'Transfer Single Primary Ownership (Owner Only)',
            method: 'POST',
            pathSegments: [
              'api',
              'workspaces',
              '{{workspaceId}}',
              'transfer-ownership',
            ],
            tokenVar: 'ownerToken',
            body: {
              targetMemberId: '{{adminMemberId}}',
              password: 'Demo@2026',
            },
            description:
              'Transfers Single Primary Ownership to another accepted member/Admin with password verification.',
          }),
        ],
      },
      {
        name: '07. Permission-Scoped & Central Registry Notifications',
        item: [
          buildItem({
            name: 'Get Notifications (Patient / Doctor / Permission-Filtered Workspace)',
            method: 'GET',
            pathSegments: ['api', 'notifications'],
            query: [{ key: 'persona', value: 'PATIENT' }],
            tokenVar: 'patientToken',
            description:
              'Returns notifications for the active persona, filtering workspace notifications strictly by the member combined permissions.',
          }),
          buildItem({
            name: 'Get Central Registry (DGHS) Governance Notifications',
            method: 'GET',
            pathSegments: ['api', 'notifications'],
            query: [{ key: 'persona', value: 'CENTRAL_REGISTRY' }],
            tokenVar: 'dghsToken',
            description:
              'Returns persistent DGHS governance notifications for pending Doctor and Facility applications.',
          }),
          buildItem({
            name: 'Mark All Notifications Read',
            method: 'POST',
            pathSegments: ['api', 'notifications', 'read-all'],
            tokenVar: 'dghsToken',
            body: {
              persona: 'CENTRAL_REGISTRY',
            },
            description:
              'Marks all notifications as read for the active persona (Patient, Doctor, Workspace, or Central Registry).',
          }),
        ],
      },
    ],
  };

  const environment = {
    id: 'unified-medi-local-env',
    name: 'Unified Health Platform — Local Environment',
    values: [
      { key: 'baseUrl', value: 'http://localhost:4000', enabled: true },
      { key: 'dghsToken', value: '', enabled: true },
      { key: 'patientToken', value: '', enabled: true },
      { key: 'doctorToken', value: '', enabled: true },
      { key: 'ownerToken', value: '', enabled: true },
      { key: 'workspaceId', value: '', enabled: true },
      { key: 'samplePatientId', value: '', enabled: true },
      { key: 'childPatientId', value: '', enabled: true },
      { key: 'sampleDoctorId', value: '', enabled: true },
      { key: 'activeQrSessionId', value: '', enabled: true },
      { key: 'prescriptionId', value: '', enabled: true },
    ],
    _postman_variable_scope: 'environment',
  };

  const collectionPath = path.join(
    POSTMAN_DIR,
    'Unified_Medi_API.postman_collection.json'
  );
  const envPath = path.join(
    POSTMAN_DIR,
    'Unified_Medi_Local.postman_environment.json'
  );

  fs.writeFileSync(collectionPath, JSON.stringify(collection, null, 2));
  fs.writeFileSync(envPath, JSON.stringify(environment, null, 2));

  console.log(`[Postman] Generated Collection: ${collectionPath}`);
  console.log(`[Postman] Generated Environment: ${envPath}`);
}

if (require.main === module) {
  generatePostmanFiles();
}
