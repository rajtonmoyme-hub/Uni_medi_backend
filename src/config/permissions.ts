export interface PermissionDefinition {
  key: string;
  domain: string;
  label: string;
  description: string;
}

export const WORKSPACE_PERMISSION_CATALOG: PermissionDefinition[] = [
  // 1. Staff & Governance
  {
    key: 'staff.view',
    domain: 'Staff & Governance',
    label: 'View Staff Directory',
    description: 'View workspace staff list, assigned roles, and contact details',
  },
  {
    key: 'staff.invite',
    domain: 'Staff & Governance',
    label: 'Invite & Revoke Staff',
    description: 'Send workspace staff invitations to Patient accounts & revoke pending invites',
  },
  {
    key: 'staff.assign_roles',
    domain: 'Staff & Governance',
    label: 'Assign Dynamic Roles',
    description: 'Assign or update custom dynamic roles for workspace staff',
  },
  {
    key: 'staff.remove',
    domain: 'Staff & Governance',
    label: 'Remove Staff Member',
    description: 'Remove/deactivate staff from workspace while preserving historical audit logs',
  },
  {
    key: 'staff.logs.view',
    domain: 'Staff & Governance',
    label: 'View Staff Performance & Logs',
    description: 'View immutable staff activity logs and performance metrics',
  },
  {
    key: 'roles.manage',
    domain: 'Staff & Governance',
    label: 'Manage Dynamic Roles',
    description: 'Create, edit, and delete custom dynamic roles & permission sets',
  },

  // 2. Doctor Affiliations
  {
    key: 'doctors.view',
    domain: 'Doctor Affiliations',
    label: 'View Affiliated Doctors',
    description: 'View affiliated doctors, schedules, and consultation fees',
  },
  {
    key: 'doctors.invite',
    domain: 'Doctor Affiliations',
    label: 'Invite & Approve Doctors',
    description: 'Send affiliation invites to doctors & accept/reject incoming doctor requests',
  },
  {
    key: 'doctors.schedule',
    domain: 'Doctor Affiliations',
    label: 'Manage Doctor Schedules & Fees',
    description: 'Configure doctor chamber timings, room numbers, and consultation fees',
  },
  {
    key: 'doctors.revoke',
    domain: 'Doctor Affiliations',
    label: 'Revoke Doctor Affiliation',
    description: "Terminate a doctor's affiliation with the workspace",
  },

  // 3. Front Desk & Appointments
  {
    key: 'appointments.view',
    domain: 'Front Desk & Appointments',
    label: 'View Appointments',
    description: 'View appointment bookings, doctor queues, and calendar',
  },
  {
    key: 'appointments.manage',
    domain: 'Front Desk & Appointments',
    label: 'Approve & Manage Appointments',
    description: 'Approve, reschedule, check-in, complete, or cancel patient appointments',
  },
  {
    key: 'patients.lookup',
    domain: 'Front Desk & Appointments',
    label: 'Lookup Patients',
    description: 'Lookup registered patients by unique_id, phone, or email',
  },

  // 4. Diagnostics & Lab Reports
  {
    key: 'reports.view',
    domain: 'Diagnostics & Lab Reports',
    label: 'View Lab Reports',
    description: 'View ordered diagnostic tests and uploaded lab reports for this workspace',
  },
  {
    key: 'reports.upload',
    domain: 'Diagnostics & Lab Reports',
    label: 'Upload Diagnostic Reports',
    description: 'Upload/generate diagnostic & lab reports to Patient Vault',
  },
  {
    key: 'reports.verify',
    domain: 'Diagnostics & Lab Reports',
    label: 'Verify Diagnostic Reports',
    description: 'Verify/sign off on diagnostic reports & trigger patient notification',
  },

  // 5. Billing & Finance
  {
    key: 'billing.view',
    domain: 'Billing & Finance',
    label: 'View Invoices & Billing',
    description: 'View patient invoices, payment status, and daily collection summaries',
  },
  {
    key: 'billing.create',
    domain: 'Billing & Finance',
    label: 'Create Patient Invoices',
    description: 'Generate consultation/lab/package invoices & send billing doc to Patient Vault',
  },
  {
    key: 'billing.manage',
    domain: 'Billing & Finance',
    label: 'Manage Payments & Refunds',
    description: 'Record payments, apply discounts, or issue refunds/voids',
  },

  // 6. Health Packages & Ads
  {
    key: 'packages.view',
    domain: 'Health Packages & Ads',
    label: 'View Health Packages',
    description: 'View promotional health packages offered by the workspace',
  },
  {
    key: 'packages.manage',
    domain: 'Health Packages & Ads',
    label: 'Manage Promotional Packages',
    description: 'Create, edit, price, and publish/unpublish health checkup packages',
  },

  // 7. Workspace Profile & Analytics
  {
    key: 'workspace.profile.edit',
    domain: 'Workspace Profile & Analytics',
    label: 'Edit Workspace Profile',
    description: 'Update workspace description, logo, departments, contact info, and banner',
  },
  {
    key: 'workspace.analytics.view',
    domain: 'Workspace Profile & Analytics',
    label: 'View Workspace Analytics',
    description: 'View workspace revenue, patient inflow, and department KPIs',
  },
  {
    key: 'notifications.receive_ops',
    domain: 'Workspace Profile & Analytics',
    label: 'Receive Operational Alerts',
    description: 'Receive general workspace operational notifications',
  },
];

export const ALL_PERMISSION_KEYS: string[] = WORKSPACE_PERMISSION_CATALOG.map(
  (p) => p.key
);

export const DEFAULT_WORKSPACE_ROLE_TEMPLATES = [
  {
    name: 'Owner',
    description: 'Single Primary Owner with full workspace governance and ownership transfer rights.',
    isSystemRole: true,
    permissions: ALL_PERMISSION_KEYS,
  },
  {
    name: 'Admin',
    description: 'Hospital Administrator with all operational permissions except managing Owner or other Admins.',
    isSystemRole: true,
    permissions: ALL_PERMISSION_KEYS,
  },
  {
    name: 'Receptionist',
    description: 'Front desk staff managing patient appointments, doctor schedules, and walk-in lookups.',
    isSystemRole: false,
    permissions: [
      'doctors.view',
      'doctors.schedule',
      'appointments.view',
      'appointments.manage',
      'patients.lookup',
      'packages.view',
      'notifications.receive_ops',
    ],
  },
  {
    name: 'Lab Technician',
    description: 'Diagnostic & pathology specialist responsible for uploading and verifying patient test reports.',
    isSystemRole: false,
    permissions: [
      'patients.lookup',
      'reports.view',
      'reports.upload',
      'reports.verify',
    ],
  },
  {
    name: 'Billing Officer',
    description: 'Cashier & accounts staff handling patient invoices, package billing, and payment records.',
    isSystemRole: false,
    permissions: [
      'patients.lookup',
      'billing.view',
      'billing.create',
      'billing.manage',
      'packages.view',
    ],
  },
  {
    name: 'Package & Marketing Coordinator',
    description: 'Manages hospital promotional packages and checkup campaigns.',
    isSystemRole: false,
    permissions: [
      'packages.view',
      'packages.manage',
      'doctors.view',
      'workspace.analytics.view',
    ],
  },
];
