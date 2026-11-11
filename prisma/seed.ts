import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import { prisma } from '../src/config/prisma';
import {
  DEFAULT_WORKSPACE_ROLE_TEMPLATES,
  ALL_PERMISSION_KEYS,
} from '../src/config/permissions';

function createSvgAvatar(initials: string, bgHex: string, fgHex = '#ffffff'): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
    <rect width="160" height="160" rx="28" fill="${bgHex}"/>
    <circle cx="80" cy="80" r="68" fill="none" stroke="${fgHex}" stroke-opacity="0.18" stroke-width="3"/>
    <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="${fgHex}" font-family="Inter, sans-serif" font-weight="700" font-size="52">${initials}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function createPackageBannerSvg(title: string, priceText: string, accentHex: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="260" viewBox="0 0 640 260">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#00401f"/>
        <stop offset="60%" stop-color="#005830"/>
        <stop offset="100%" stop-color="${accentHex}"/>
      </linearGradient>
    </defs>
    <rect width="640" height="260" rx="16" fill="url(#bg)"/>
    <circle cx="560" cy="50" r="110" fill="#ffffff" fill-opacity="0.06"/>
    <circle cx="520" cy="210" r="80" fill="#ffffff" fill-opacity="0.05"/>
    <rect x="28" y="28" width="150" height="30" rx="15" fill="#fdf9ef" fill-opacity="0.95"/>
    <text x="103" y="48" text-anchor="middle" fill="#9a7220" font-family="Inter, sans-serif" font-weight="700" font-size="12">DGHS VERIFIED OFFER</text>
    <text x="28" y="106" fill="#ffffff" font-family="Georgia, serif" font-weight="700" font-size="26">${title}</text>
    <text x="28" y="145" fill="#d7e9de" font-family="Inter, sans-serif" font-weight="500" font-size="15">Complete Diagnostic Screening + Specialist Consultation</text>
    <rect x="28" y="176" width="210" height="50" rx="10" fill="#ffffff"/>
    <text x="133" y="207" text-anchor="middle" fill="#005830" font-family="Inter, sans-serif" font-weight="800" font-size="20">${priceText}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export async function seedDatabase() {
  console.log('[Seed] Clearing existing database records...');
  await prisma.notification.deleteMany();
  await prisma.patientActivityLog.deleteMany();
  await prisma.workspaceAuditLog.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.qrShareSession.deleteMany();
  await prisma.vaultDocument.deleteMany();
  await prisma.healthPackage.deleteMany();
  await prisma.doctorWorkspaceAffiliation.deleteMany();
  await prisma.workspaceMemberRole.deleteMany();
  await prisma.workspaceMember.deleteMany();
  await prisma.workspaceRole.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.doctorProfile.deleteMany();
  await prisma.familyRelationship.deleteMany();
  await prisma.patientUser.deleteMany();

  const defaultPassHash = await bcrypt.hash('Demo@2026', 10);

  // =========================================================================
  // 1. PATIENTS & FAMILY ACCOUNTS (Maintainer + Child + Senior Old Account)
  // =========================================================================
  const tanvir = await prisma.patientUser.create({
    data: {
      uniqueId: 'PAT-2026-100001',
      name: 'Tanvir Ahmed',
      email: 'patient@demo.bd',
      phone: '+8801711000001',
      secondaryEmails: ['tanvir.personal@gmail.com', 'tanvir.office@corp.bd'],
      secondaryPhones: ['+8801811000001'],
      passwordHash: defaultPassHash,
      nationalId: '1992269481001',
      profileAvatar: createSvgAvatar('TA', '#005830'),
      accountType: 'NORMAL',
      status: 'ACTIVE',
      isOtpVerified: true,
      bloodGroup: 'O+',
      gender: 'Male',
      dateOfBirth: '1992-05-14',
      address: 'House 24, Road 9/A, Dhanmondi, Dhaka-1209',
      emergencyContact: '+8801711000099 (Wife)',
    },
  });

  const childAyaan = await prisma.patientUser.create({
    data: {
      uniqueId: 'PAT-2026-100002',
      name: 'Ayaan Ahmed (Child)',
      email: 'child@demo.bd',
      phone: '+8801711000002',
      passwordHash: defaultPassHash,
      profileAvatar: createSvgAvatar('AA', '#17864e'),
      accountType: 'CHILD',
      status: 'ACTIVE',
      isOtpVerified: true,
      bloodGroup: 'O+',
      gender: 'Male',
      dateOfBirth: '2019-08-20',
      address: 'House 24, Road 9/A, Dhanmondi, Dhaka-1209',
      emergencyContact: '+8801711000001 (Father - Tanvir Ahmed)',
    },
  });

  const seniorKarim = await prisma.patientUser.create({
    data: {
      uniqueId: 'PAT-2026-100003',
      name: 'Abdul Karim Ahmed (Senior)',
      email: 'senior@demo.bd',
      phone: '+8801711000003',
      passwordHash: defaultPassHash,
      nationalId: '1954269481003',
      profileAvatar: createSvgAvatar('AK', '#9a7220'),
      accountType: 'OLD',
      status: 'ACTIVE',
      isOtpVerified: true,
      bloodGroup: 'B+',
      gender: 'Male',
      dateOfBirth: '1954-01-10',
      address: 'House 24, Road 9/A, Dhanmondi, Dhaka-1209',
      emergencyContact: '+8801711000001 (Son - Tanvir Ahmed)',
    },
  });

  const disabledPatient = await prisma.patientUser.create({
    data: {
      uniqueId: 'PAT-2026-100004',
      name: 'Rashedul Islam',
      email: 'disabled.patient@demo.bd',
      phone: '+8801711000004',
      passwordHash: defaultPassHash,
      nationalId: '1988269481004',
      profileAvatar: createSvgAvatar('RI', '#d82028'),
      accountType: 'NORMAL',
      status: 'DISABLED',
      isOtpVerified: true,
      bloodGroup: 'A+',
      gender: 'Male',
      dateOfBirth: '1988-11-03',
      address: 'Mirpur-10, Dhaka-1216',
    },
  });

  // Link Child & Senior accounts to Tanvir Ahmed as Family Maintainer
  await prisma.familyRelationship.createMany({
    data: [
      {
        maintainerId: tanvir.id,
        dependentId: childAyaan.id,
        relationshipType: 'CHILD',
        relationshipLabel: 'Son (Child Account)',
        initiatedBy: 'MAINTAINER',
        status: 'ACTIVE',
      },
      {
        maintainerId: tanvir.id,
        dependentId: seniorKarim.id,
        relationshipType: 'OLD',
        relationshipLabel: 'Father (Senior Parent Account)',
        initiatedBy: 'DEPENDENT',
        status: 'ACTIVE',
      },
    ],
  });

  // =========================================================================
  // 2. DOCTORS (Each Doctor has a mandatory base PatientUser account!)
  // =========================================================================
  const drRahmanPatient = await prisma.patientUser.create({
    data: {
      uniqueId: 'PAT-2026-300001',
      name: 'Prof. Dr. Mahbubur Rahman',
      email: 'dr.rahman@demo.bd',
      phone: '+8801722000001',
      passwordHash: defaultPassHash,
      nationalId: '1975269483001',
      profileAvatar: createSvgAvatar('MR', '#005830'),
      accountType: 'NORMAL',
      status: 'ACTIVE',
      isOtpVerified: true,
      bloodGroup: 'A+',
      gender: 'Male',
      dateOfBirth: '1975-03-12',
      address: 'Gulshan-2, Dhaka-1212',
    },
  });

  const drRahman = await prisma.doctorProfile.create({
    data: {
      doctorIdCode: 'DOC-2026-5001',
      patientUserId: drRahmanPatient.id,
      doctorLicense: 'BMDC-A-45821',
      nationalId: '1975269483001',
      specialty: 'Cardiology',
      degrees: ['MBBS (DMC)', 'FCPS (Cardiology)', 'MD (NICVD)', 'FACC (USA)'],
      achievements: [
        'Gold Medalist — Bangladesh Cardiac Society 2022',
        'Chief Interventional Cardiologist (20+ Years Experience)',
        'Published 38 Peer-Reviewed Clinical Research Papers',
      ],
      bio: 'Senior Consultant Interventional Cardiologist specializing in complex coronary angioplasty, heart failure management, and preventive cardiology.',
      area: 'Gulshan & Dhanmondi, Dhaka',
      experienceYears: 21,
      defaultConsultationFee: 1500,
      profileImage: createSvgAvatar('DR', '#005830'),
      profileVisibility: {
        showDegrees: true,
        showAchievements: true,
        showBio: true,
        showPhoto: true,
        showExperience: true,
        customHeadline: 'Available for Evening Cardiac Consultations & QR Vault Review',
      },
      approvalStatus: 'APPROVED',
      dghsNotes: 'Verified against BMDC Registry & National ID Database.',
      approvedAt: new Date(Date.now() - 30 * 86400000),
    },
  });

  const drNusratPatient = await prisma.patientUser.create({
    data: {
      uniqueId: 'PAT-2026-300002',
      name: 'Dr. Nusrat Jahan Chowdhury',
      email: 'dr.nusrat@demo.bd',
      phone: '+8801722000002',
      passwordHash: defaultPassHash,
      nationalId: '1982269483002',
      profileAvatar: createSvgAvatar('NJ', '#0b6e3e'),
      accountType: 'NORMAL',
      status: 'ACTIVE',
      isOtpVerified: true,
      bloodGroup: 'B+',
      gender: 'Female',
      dateOfBirth: '1982-09-25',
      address: 'Dhanmondi, Dhaka-1209',
    },
  });

  const drNusrat = await prisma.doctorProfile.create({
    data: {
      doctorIdCode: 'DOC-2026-5002',
      patientUserId: drNusratPatient.id,
      doctorLicense: 'BMDC-A-59102',
      nationalId: '1982269483002',
      specialty: 'Gynecology',
      degrees: ['MBBS (SSMC)', 'FCPS (Obs & Gynae)', 'MRCOG (UK)'],
      achievements: [
        'Senior Consultant in High-Risk Pregnancy & Laparoscopic Surgery',
        'National Maternal Health Excellence Award 2024',
      ],
      bio: 'Dedicated Obstetrician & Gynecologist providing evidence-based maternal care, fetal medicine, and minimally invasive gynecological procedures.',
      area: 'Dhanmondi, Dhaka',
      experienceYears: 14,
      defaultConsultationFee: 1200,
      profileImage: createSvgAvatar('NJ', '#0b6e3e'),
      approvalStatus: 'APPROVED',
      dghsNotes: 'BMDC and MRCOG credentials verified.',
      approvedAt: new Date(Date.now() - 25 * 86400000),
    },
  });

  const drKamalPatient = await prisma.patientUser.create({
    data: {
      uniqueId: 'PAT-2026-300003',
      name: 'Assoc. Prof. Dr. Kamal Hossain',
      email: 'dr.kamal@demo.bd',
      phone: '+8801722000003',
      passwordHash: defaultPassHash,
      nationalId: '1979269483003',
      profileAvatar: createSvgAvatar('KH', '#17864e'),
      accountType: 'NORMAL',
      status: 'ACTIVE',
      isOtpVerified: true,
      bloodGroup: 'AB+',
      gender: 'Male',
      dateOfBirth: '1979-07-19',
      address: 'Panthapath, Dhaka-1205',
    },
  });

  const drKamal = await prisma.doctorProfile.create({
    data: {
      doctorIdCode: 'DOC-2026-5003',
      patientUserId: drKamalPatient.id,
      doctorLicense: 'BMDC-A-61209',
      nationalId: '1979269483003',
      specialty: 'Orthopedics',
      degrees: ['MBBS (DMC)', 'MS (Orthopaedics - NITOR)', 'AO Trauma Fellow (Germany)'],
      achievements: [
        'Performed 2,500+ Arthroscopic & Joint Replacement Surgeries',
        'Sports Injury Specialist for National Athletes',
      ],
      bio: 'Specialist in trauma surgery, knee/hip arthroplasty, spine disorders, and pediatric orthopedics.',
      area: 'Panthapath & Uttara, Dhaka',
      experienceYears: 16,
      defaultConsultationFee: 1300,
      profileImage: createSvgAvatar('KH', '#17864e'),
      approvalStatus: 'APPROVED',
      dghsNotes: 'Verified with NITOR and BMDC records.',
      approvedAt: new Date(Date.now() - 20 * 86400000),
    },
  });

  // Pending Doctor for live Central Registry approval demo
  const drPendingPatient = await prisma.patientUser.create({
    data: {
      uniqueId: 'PAT-2026-300004',
      name: 'Dr. Farhana Yasmin',
      email: 'dr.pending@demo.bd',
      phone: '+8801722000004',
      passwordHash: defaultPassHash,
      nationalId: '1990269483004',
      profileAvatar: createSvgAvatar('FY', '#9a7220'),
      accountType: 'NORMAL',
      status: 'ACTIVE',
      isOtpVerified: true,
      bloodGroup: 'O-',
      gender: 'Female',
      dateOfBirth: '1990-02-11',
      address: 'Uttara Sector 7, Dhaka-1230',
    },
  });

  const drPendingProfile = await prisma.doctorProfile.create({
    data: {
      doctorIdCode: 'DOC-2026-5004',
      patientUserId: drPendingPatient.id,
      doctorLicense: 'BMDC-A-78410',
      nationalId: '1990269483004',
      specialty: 'Neurology',
      degrees: ['MBBS (BSMMU)', 'MD (Neurology)'],
      achievements: ['Clinical Stroke Fellowship — BSMMU'],
      bio: 'Clinical Neurologist focusing on stroke rehabilitation, migraine, and movement disorders.',
      area: 'Uttara, Dhaka',
      experienceYears: 7,
      defaultConsultationFee: 1000,
      profileImage: createSvgAvatar('FY', '#9a7220'),
      approvalStatus: 'PENDING',
      dghsNotes: 'Awaiting DGHS cross-check of BMDC-A-78410.',
    },
  });

  // Declined Doctor for status filter showcase
  const drDeclinedPatient = await prisma.patientUser.create({
    data: {
      uniqueId: 'PAT-2026-300005',
      name: 'Dr. Tariqul Alam',
      email: 'dr.declined@demo.bd',
      phone: '+8801722000005',
      passwordHash: defaultPassHash,
      nationalId: '1986269483005',
      profileAvatar: createSvgAvatar('TA', '#d82028'),
      accountType: 'NORMAL',
      status: 'ACTIVE',
      isOtpVerified: true,
    },
  });

  await prisma.doctorProfile.create({
    data: {
      doctorIdCode: 'DOC-2026-5005',
      patientUserId: drDeclinedPatient.id,
      doctorLicense: 'BMDC-UNVERIFIED-991',
      nationalId: '1986269483005',
      specialty: 'Dermatology',
      degrees: ['MBBS', 'DDV'],
      achievements: [],
      bio: 'Dermatology practitioner.',
      area: 'Chattogram',
      experienceYears: 4,
      defaultConsultationFee: 800,
      approvalStatus: 'DECLINED',
      dghsNotes: 'Declined by DGHS: License number did not match national registry.',
    },
  });

  // =========================================================================
  // 3. WORKSPACES / HOSPITALS & STAFF MEMBERS
  // =========================================================================
  const evercareOwner = await prisma.patientUser.create({
    data: {
      uniqueId: 'PAT-2026-200001',
      name: 'Engr. Syed Mahmudul Haque',
      email: 'owner.evercare@demo.bd',
      phone: '+8801733000001',
      passwordHash: defaultPassHash,
      nationalId: '1970269482001',
      profileAvatar: createSvgAvatar('SM', '#005830'),
      accountType: 'NORMAL',
      status: 'ACTIVE',
      isOtpVerified: true,
      bloodGroup: 'B+',
      gender: 'Male',
      address: 'Bashundhara R/A, Dhaka-1229',
    },
  });

  const evercareAdmin = await prisma.patientUser.create({
    data: {
      uniqueId: 'PAT-2026-200002',
      name: 'Nafisa Tabassum (Hospital Admin)',
      email: 'admin.evercare@demo.bd',
      phone: '+8801733000002',
      passwordHash: defaultPassHash,
      nationalId: '1987269482002',
      profileAvatar: createSvgAvatar('NT', '#0b6e3e'),
      accountType: 'NORMAL',
      status: 'ACTIVE',
      isOtpVerified: true,
    },
  });

  const multiRoleStaff = await prisma.patientUser.create({
    data: {
      uniqueId: 'PAT-2026-200003',
      name: 'Sadia Afrin (Reception & Billing)',
      email: 'staff.multi@demo.bd',
      phone: '+8801733000003',
      passwordHash: defaultPassHash,
      nationalId: '1995269482003',
      profileAvatar: createSvgAvatar('SA', '#17864e'),
      accountType: 'NORMAL',
      status: 'ACTIVE',
      isOtpVerified: true,
    },
  });

  const labTechStaff = await prisma.patientUser.create({
    data: {
      uniqueId: 'PAT-2026-200004',
      name: 'Mehedi Hasan (Senior Lab Tech)',
      email: 'lab.evercare@demo.bd',
      phone: '+8801733000004',
      passwordHash: defaultPassHash,
      nationalId: '1993269482004',
      profileAvatar: createSvgAvatar('MH', '#2e9c64'),
      accountType: 'NORMAL',
      status: 'ACTIVE',
      isOtpVerified: true,
    },
  });

  const removedExStaff = await prisma.patientUser.create({
    data: {
      uniqueId: 'PAT-2026-200005',
      name: 'Zahidul Karim (Former Staff)',
      email: 'exstaff.evercare@demo.bd',
      phone: '+8801733000005',
      passwordHash: defaultPassHash,
      nationalId: '1991269482005',
      profileAvatar: createSvgAvatar('ZK', '#7c8b82'),
      accountType: 'NORMAL',
      status: 'ACTIVE',
      isOtpVerified: true,
    },
  });

  const evercareHospital = await prisma.workspace.create({
    data: {
      workspaceCode: 'WSP-2026-9001',
      name: 'Evercare Multidisciplinary Hospital',
      type: 'HOSPITAL',
      registrationLicense: 'DGHS-HOSP-2026-001',
      ownerPatientId: evercareOwner.id,
      email: 'info@evercare-demo.bd',
      phone: '+8809666710678',
      address: 'Plot 81, Block E, Bashundhara R/A, Dhaka-1229',
      area: 'Bashundhara & Gulshan, Dhaka',
      description:
        'JCI-accredited tertiary care hospital with 24/7 cardiac, neurology, maternal, orthopaedic, and automated molecular diagnostic laboratories.',
      logoUrl: createSvgAvatar('EH', '#005830'),
      departments: [
        'Cardiology',
        'Gynecology',
        'Orthopedics',
        'Neurology',
        'Pathology & Molecular Lab',
        '24/7 Emergency',
      ],
      operatingHours: '24/7 Inpatient & Emergency | OPD 8:00 AM - 10:00 PM',
      approvalStatus: 'APPROVED',
      dghsNotes: 'DGHS Tertiary Hospital License verified and approved.',
      approvedAt: new Date(Date.now() - 60 * 86400000),
    },
  });

  // Create system and dynamic roles for Evercare Hospital
  const evercareRolesMap: Record<string, any> = {};
  for (const tpl of DEFAULT_WORKSPACE_ROLE_TEMPLATES) {
    const r = await prisma.workspaceRole.create({
      data: {
        workspaceId: evercareHospital.id,
        name: tpl.name,
        description: tpl.description,
        isSystemRole: tpl.isSystemRole,
        permissions: tpl.permissions,
      },
    });
    evercareRolesMap[tpl.name] = r;
  }

  // Members of Evercare Hospital
  const ownerMember = await prisma.workspaceMember.create({
    data: {
      workspaceId: evercareHospital.id,
      patientUserId: evercareOwner.id,
      isOwner: true,
      isAdmin: true,
      staffTitle: 'Founder & Single Primary Owner',
      department: 'Board of Governance',
      invitationStatus: 'ACCEPTED',
      joinedAt: new Date(Date.now() - 60 * 86400000),
    },
  });
  await prisma.workspaceMemberRole.create({
    data: { memberId: ownerMember.id, roleId: evercareRolesMap['Owner'].id },
  });

  const adminMember = await prisma.workspaceMember.create({
    data: {
      workspaceId: evercareHospital.id,
      patientUserId: evercareAdmin.id,
      isOwner: false,
      isAdmin: true,
      staffTitle: 'Chief Hospital Administrator',
      department: 'Hospital Administration',
      invitationStatus: 'ACCEPTED',
      invitedByPatientId: evercareOwner.id,
      joinedAt: new Date(Date.now() - 45 * 86400000),
    },
  });
  await prisma.workspaceMemberRole.create({
    data: { memberId: adminMember.id, roleId: evercareRolesMap['Admin'].id },
  });

  // Multi-role staff member: Assigned BOTH Receptionist AND Billing Officer roles!
  const multiMember = await prisma.workspaceMember.create({
    data: {
      workspaceId: evercareHospital.id,
      patientUserId: multiRoleStaff.id,
      isOwner: false,
      isAdmin: false,
      staffTitle: 'Front Desk & Billing Coordinator',
      department: 'Outpatient Reception & Cashier',
      invitationStatus: 'ACCEPTED',
      invitedByPatientId: evercareAdmin.id,
      joinedAt: new Date(Date.now() - 30 * 86400000),
    },
  });
  await prisma.workspaceMemberRole.createMany({
    data: [
      { memberId: multiMember.id, roleId: evercareRolesMap['Receptionist'].id },
      {
        memberId: multiMember.id,
        roleId: evercareRolesMap['Billing Officer'].id,
      },
    ],
  });

  // Lab Technician staff member
  const labMember = await prisma.workspaceMember.create({
    data: {
      workspaceId: evercareHospital.id,
      patientUserId: labTechStaff.id,
      isOwner: false,
      isAdmin: false,
      staffTitle: 'Senior Pathology Technologist',
      department: 'Diagnostic & Molecular Lab',
      invitationStatus: 'ACCEPTED',
      invitedByPatientId: evercareAdmin.id,
      joinedAt: new Date(Date.now() - 28 * 86400000),
    },
  });
  await prisma.workspaceMemberRole.create({
    data: {
      memberId: labMember.id,
      roleId: evercareRolesMap['Lab Technician'].id,
    },
  });

  // Removed staff member (Status = REMOVED, but historical performance logs preserved!)
  const removedMember = await prisma.workspaceMember.create({
    data: {
      workspaceId: evercareHospital.id,
      patientUserId: removedExStaff.id,
      isOwner: false,
      isAdmin: false,
      staffTitle: 'Night Shift Receptionist (Removed)',
      department: 'Front Desk',
      invitationStatus: 'REMOVED',
      invitedByPatientId: evercareAdmin.id,
      joinedAt: new Date(Date.now() - 50 * 86400000),
      removedAt: new Date(Date.now() - 5 * 86400000),
    },
  });
  await prisma.workspaceMemberRole.create({
    data: {
      memberId: removedMember.id,
      roleId: evercareRolesMap['Receptionist'].id,
    },
  });

  // Pending Staff Invitation for Tanvir Ahmed so he can test Accept/Revoke in Patient Portal
  const pendingTanvirInvite = await prisma.workspaceMember.create({
    data: {
      workspaceId: evercareHospital.id,
      patientUserId: tanvir.id,
      isOwner: false,
      isAdmin: false,
      staffTitle: 'Visiting Health Package Advisor',
      department: 'Preventive Wellness',
      invitationStatus: 'PENDING',
      invitedByPatientId: evercareOwner.id,
    },
  });
  await prisma.workspaceMemberRole.create({
    data: {
      memberId: pendingTanvirInvite.id,
      roleId: evercareRolesMap['Package & Marketing Coordinator'].id,
    },
  });

  // Workspace 2: Popular Diagnostic & Imaging Center (APPROVED)
  const popularDiagnostic = await prisma.workspace.create({
    data: {
      workspaceCode: 'WSP-2026-9002',
      name: 'Popular Diagnostic & Imaging Center',
      type: 'DIAGNOSTIC_CENTER',
      registrationLicense: 'DGHS-DIAG-2026-002',
      ownerPatientId: evercareOwner.id,
      email: 'care@populardiagnostic-demo.bd',
      phone: '+8809613787801',
      address: 'House 16, Road 2, Dhanmondi, Dhaka-1205',
      area: 'Dhanmondi, Dhaka',
      description:
        'Premier diagnostic imaging, MRI, CT scan, pathology, and specialist consultation chambers.',
      logoUrl: createSvgAvatar('PD', '#0b6e3e'),
      departments: ['Pathology', 'Radiology & Imaging', 'Cardiology', 'Gynecology'],
      approvalStatus: 'APPROVED',
      dghsNotes: 'Approved Diagnostic Center.',
      approvedAt: new Date(Date.now() - 45 * 86400000),
    },
  });

  for (const tpl of DEFAULT_WORKSPACE_ROLE_TEMPLATES) {
    const r = await prisma.workspaceRole.create({
      data: {
        workspaceId: popularDiagnostic.id,
        name: tpl.name,
        description: tpl.description,
        isSystemRole: tpl.isSystemRole,
        permissions: tpl.permissions,
      },
    });
    if (tpl.name === 'Owner') {
      const m = await prisma.workspaceMember.create({
        data: {
          workspaceId: popularDiagnostic.id,
          patientUserId: evercareOwner.id,
          isOwner: true,
          isAdmin: true,
          staffTitle: 'Primary Owner',
          department: 'Executive',
          invitationStatus: 'ACCEPTED',
          joinedAt: new Date(),
        },
      });
      await prisma.workspaceMemberRole.create({
        data: { memberId: m.id, roleId: r.id },
      });
    }
  }

  // Workspace 3: Square Clinical & Orthopaedic Center (APPROVED)
  const squareClinic = await prisma.workspace.create({
    data: {
      workspaceCode: 'WSP-2026-9003',
      name: 'Square Clinical & Orthopaedic Center',
      type: 'CLINIC',
      registrationLicense: 'DGHS-CLIN-2026-003',
      ownerPatientId: evercareOwner.id,
      email: 'info@squareclinic-demo.bd',
      phone: '+8809610010616',
      address: '18/F, Bir Uttam Qazi Nuruzzaman Sarak, Panthapath, Dhaka-1205',
      area: 'Panthapath, Dhaka',
      description:
        'Specialized trauma, orthopaedics, physiotherapy, and outpatient surgical clinic.',
      logoUrl: createSvgAvatar('SC', '#17864e'),
      departments: ['Orthopedics', 'Physiotherapy', 'Sports Medicine'],
      approvalStatus: 'APPROVED',
      dghsNotes: 'Approved Specialty Clinic.',
      approvedAt: new Date(Date.now() - 35 * 86400000),
    },
  });

  for (const tpl of DEFAULT_WORKSPACE_ROLE_TEMPLATES) {
    const r = await prisma.workspaceRole.create({
      data: {
        workspaceId: squareClinic.id,
        name: tpl.name,
        description: tpl.description,
        isSystemRole: tpl.isSystemRole,
        permissions: tpl.permissions,
      },
    });
    if (tpl.name === 'Owner') {
      const m = await prisma.workspaceMember.create({
        data: {
          workspaceId: squareClinic.id,
          patientUserId: evercareOwner.id,
          isOwner: true,
          isAdmin: true,
          staffTitle: 'Primary Owner',
          department: 'Executive',
          invitationStatus: 'ACCEPTED',
          joinedAt: new Date(),
        },
      });
      await prisma.workspaceMemberRole.create({
        data: { memberId: m.id, roleId: r.id },
      });
    }
  }

  // Workspace 4: Pending Hospital for Central Registry live approval demo
  const pendingGreenLife = await prisma.workspace.create({
    data: {
      workspaceCode: 'WSP-2026-9004',
      name: 'Green Life Specialized Hospital & Chamber',
      type: 'HOSPITAL',
      registrationLicense: 'DGHS-HOSP-2026-099',
      ownerPatientId: evercareAdmin.id,
      email: 'registration@greenlife-demo.bd',
      phone: '+8801755009900',
      address: '32 Green Road, Dhanmondi, Dhaka-1205',
      area: 'Green Road, Dhaka',
      description:
        'Newly registered 250-bed multidisciplinary hospital awaiting DGHS inspection and final approval.',
      logoUrl: createSvgAvatar('GL', '#9a7220'),
      departments: ['Internal Medicine', 'Pediatrics', 'ICU & Critical Care'],
      approvalStatus: 'PENDING',
      dghsNotes: 'Pending DGHS license cross-check.',
    },
  });

  // =========================================================================
  // 4. DOCTOR <-> WORKSPACE AFFILIATIONS (Multiple Hospitals & Different Fees!)
  // =========================================================================
  await prisma.doctorWorkspaceAffiliation.createMany({
    data: [
      {
        doctorId: drRahman.id,
        workspaceId: evercareHospital.id,
        initiatedBy: 'WORKSPACE',
        status: 'ACTIVE',
        consultationFee: 1500,
        schedule: 'Sun, Tue, Thu: 5:00 PM - 9:00 PM',
        roomNumber: 'Cardiac Wing — Room 402',
        department: 'Cardiology',
      },
      {
        doctorId: drRahman.id,
        workspaceId: popularDiagnostic.id,
        initiatedBy: 'DOCTOR',
        status: 'ACTIVE',
        consultationFee: 1200,
        schedule: 'Mon, Wed: 6:00 PM - 9:30 PM',
        roomNumber: 'Chamber 205',
        department: 'Cardiology',
      },
      {
        doctorId: drNusrat.id,
        workspaceId: evercareHospital.id,
        initiatedBy: 'WORKSPACE',
        status: 'ACTIVE',
        consultationFee: 1200,
        schedule: 'Sat, Mon, Wed: 4:00 PM - 8:00 PM',
        roomNumber: 'Maternal Care — Room 310',
        department: 'Gynecology',
      },
      {
        doctorId: drNusrat.id,
        workspaceId: popularDiagnostic.id,
        initiatedBy: 'WORKSPACE',
        status: 'PENDING',
        consultationFee: 1000,
        schedule: 'Fri: 10:00 AM - 1:00 PM',
        roomNumber: 'Chamber 108',
        department: 'Gynecology',
      },
      {
        doctorId: drKamal.id,
        workspaceId: squareClinic.id,
        initiatedBy: 'WORKSPACE',
        status: 'ACTIVE',
        consultationFee: 1300,
        schedule: 'Daily: 5:00 PM - 9:00 PM',
        roomNumber: 'Ortho Suite 101',
        department: 'Orthopedics',
      },
      {
        doctorId: drKamal.id,
        workspaceId: evercareHospital.id,
        initiatedBy: 'DOCTOR',
        status: 'ACTIVE',
        consultationFee: 1500,
        schedule: 'Fri, Sat: 10:00 AM - 2:00 PM',
        roomNumber: 'Ortho Wing — Room 204',
        department: 'Orthopedics',
      },
    ],
  });

  // =========================================================================
  // 5. PROMOTIONAL HEALTH PACKAGES (e.g., "Full Body Checkup - Only 10,000 Tk")
  // =========================================================================
  await prisma.healthPackage.createMany({
    data: [
      {
        packageCode: 'PKG-2026-10001',
        workspaceId: evercareHospital.id,
        title: 'Full Body Checkup — Executive Wellness',
        tagline: 'Full Body Checkup Only 10,000 Tk',
        description:
          'Complete head-to-toe preventive health screening including 42 vital blood & organ biomarkers, cardiac screening, imaging, and senior consultant review.',
        price: 10000,
        originalPrice: 14500,
        includedTests: [
          'Complete Blood Count (CBC) with ESR',
          'Fasting Lipid Profile (Cholesterol, HDL, LDL, Triglycerides)',
          'HbA1c & Fasting Blood Glucose',
          'Liver Function Test (SGPT, Bilirubin, ALP)',
          'Renal Function (Serum Creatinine, Urea, Electrolytes)',
          'Thyroid Stimulating Hormone (TSH)',
          '12-Lead Digital ECG & 2D Echocardiogram',
          'Digital Chest X-Ray & Whole Abdomen Ultrasound',
          'Specialist Physician Consultation & Diet Plan',
        ],
        bannerImage: createPackageBannerSvg(
          'Full Body Checkup',
          'Only 10,000 Tk',
          '#17864e'
        ),
        durationLabel: 'Same Day Digital Vault Report',
        isFeatured: true,
        isActive: true,
        createdByMemberId: ownerMember.id,
      },
      {
        packageCode: 'PKG-2026-10002',
        workspaceId: evercareHospital.id,
        title: 'Comprehensive Cardiac & Hypertension Screening',
        tagline: 'Heart Checkup Only 7,500 Tk',
        description:
          'Recommended for adults 35+ or patients with hypertension, chest discomfort, or family history of heart disease.',
        price: 7500,
        originalPrice: 10500,
        includedTests: [
          '2D Color Doppler Echocardiography',
          'Exercise Tolerance Test (ETT / Stress Test)',
          'High-Sensitivity Troponin-I & Lipid Profile',
          'HbA1c & Serum Creatinine',
          'Senior Cardiologist Consultation (Prof. Dr. Mahbubur Rahman)',
        ],
        bannerImage: createPackageBannerSvg(
          'Cardiac Heart Screening',
          'Only 7,500 Tk',
          '#0b6e3e'
        ),
        durationLabel: '4 Hours Express Turnaround',
        isFeatured: true,
        isActive: true,
        createdByMemberId: adminMember.id,
      },
      {
        packageCode: 'PKG-2026-10003',
        workspaceId: popularDiagnostic.id,
        title: 'Complete Diabetic, Thyroid & Metabolic Panel',
        tagline: 'Metabolic Checkup Only 4,500 Tk',
        description:
          'Comprehensive endocrine and diabetic screening with automated analyzer precision.',
        price: 4500,
        originalPrice: 6200,
        includedTests: [
          'HbA1c (Glycosylated Hemoglobin)',
          'Fasting & 2-Hour Postprandial Blood Sugar',
          'Free T3, Free T4 & TSH',
          'Urine Microalbumin & Creatinine Ratio',
          'Lipid Profile',
        ],
        bannerImage: createPackageBannerSvg(
          'Diabetic & Thyroid Panel',
          'Only 4,500 Tk',
          '#2e9c64'
        ),
        durationLabel: 'Same Day Delivery',
        isFeatured: true,
        isActive: true,
      },
      {
        packageCode: 'PKG-2026-10004',
        workspaceId: squareClinic.id,
        title: 'Senior Citizen Bone, Joint & Arthritis Checkup',
        tagline: 'Bone & Joint Package Only 6,000 Tk',
        description:
          'Tailored for senior citizens experiencing joint pain, osteoporosis, or mobility stiffness.',
        price: 6000,
        originalPrice: 8500,
        includedTests: [
          'DEXA Bone Mineral Density (BMD) Scan',
          'Vitamin D3 (25-OH) & Serum Calcium',
          'Serum Uric Acid, RA Factor & CRP',
          'Bilateral Knee Digital X-Ray',
          'Orthopaedic Specialist Consultation',
        ],
        bannerImage: createPackageBannerSvg(
          'Senior Bone & Joint Care',
          'Only 6,000 Tk',
          '#9a7220'
        ),
        durationLabel: 'Same Day Consultation',
        isFeatured: true,
        isActive: true,
      },
    ],
  });

  // =========================================================================
  // 6. VAULT DOCUMENTS (Prescriptions, Lab Reports & Billing Invoices)
  // =========================================================================
  const rx1 = await prisma.vaultDocument.create({
    data: {
      documentCode: 'RX-2026-880101',
      patientId: tanvir.id,
      type: 'PRESCRIPTION',
      title: 'Prescription — Mild Essential Hypertension & Dyslipidemia',
      summary: 'Amlodipine 5mg + Rosuvastatin 10mg | Lifestyle & Low-Sodium Diet',
      doctorId: drRahman.id,
      doctorNameSnapshot: 'Prof. Dr. Mahbubur Rahman',
      workspaceId: evercareHospital.id,
      workspaceNameSnapshot: 'Evercare Multidisciplinary Hospital',
      isImmutable: true,
      structuredData: {
        diagnosis: 'Stage-1 Essential Hypertension with Borderline Dyslipidemia',
        chiefComplaints: 'Occasional occipital headache and evening fatigue for 2 weeks.',
        vitals: {
          bp: '138/88 mmHg',
          pulse: '78 bpm',
          temp: '98.4 F',
          weight: '74 kg',
        },
        medications: [
          {
            name: 'Tab. Bizoran / Amlodipine 5mg',
            dosage: '0 + 0 + 1',
            duration: '30 Days',
            instruction: 'After dinner',
          },
          {
            name: 'Tab. Rosuva / Rosuvastatin 10mg',
            dosage: '0 + 0 + 1',
            duration: '60 Days',
            instruction: 'At bedtime',
          },
        ],
        recommendedTests: ['Fasting Lipid Profile', '12-Lead ECG'],
        advice:
          'Reduce dietary salt intake, walk briskly for 30 minutes daily, and monitor BP twice weekly.',
        followUpDate: '2026-12-10',
        doctorLicense: 'BMDC-A-45821',
        doctorSpecialty: 'Cardiology',
        doctorDegrees: ['MBBS (DMC)', 'FCPS (Cardiology)', 'MD (NICVD)', 'FACC (USA)'],
      },
    },
  });

  const lab1 = await prisma.vaultDocument.create({
    data: {
      documentCode: 'LAB-2026-770201',
      patientId: tanvir.id,
      type: 'LAB_REPORT',
      title: 'Comprehensive Lipid Profile & CBC Report',
      summary: 'Total Cholesterol: 184 mg/dL (Normal) | Hemoglobin: 14.8 g/dL',
      doctorId: drRahman.id,
      doctorNameSnapshot: 'Prof. Dr. Mahbubur Rahman',
      workspaceId: evercareHospital.id,
      workspaceNameSnapshot: 'Evercare Multidisciplinary Hospital',
      uploadedByMemberId: labMember.id,
      structuredData: {
        testCategory: 'Biochemistry & Hematology',
        parameters: [
          {
            name: 'Hemoglobin (Hb)',
            result: '14.8 g/dL',
            referenceRange: '13.5 - 17.5 g/dL',
            flag: 'NORMAL',
          },
          {
            name: 'Total Cholesterol',
            result: '184 mg/dL',
            referenceRange: '< 200 mg/dL',
            flag: 'NORMAL',
          },
          {
            name: 'LDL Cholesterol',
            result: '108 mg/dL',
            referenceRange: '< 100 mg/dL',
            flag: 'BORDERLINE',
          },
          {
            name: 'HDL Cholesterol',
            result: '48 mg/dL',
            referenceRange: '> 40 mg/dL',
            flag: 'NORMAL',
          },
          {
            name: 'Triglycerides',
            result: '140 mg/dL',
            referenceRange: '< 150 mg/dL',
            flag: 'NORMAL',
          },
          {
            name: 'Fasting Blood Glucose',
            result: '5.2 mmol/L',
            referenceRange: '3.9 - 5.6 mmol/L',
            flag: 'NORMAL',
          },
        ],
        conclusion:
          'Normal hematology profile. Mildly borderline LDL cholesterol responding well to statin therapy.',
        verified: true,
        verifiedBy: 'Mehedi Hasan (Senior Lab Tech)',
        uploadedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
      },
    },
  });

  const bill1 = await prisma.vaultDocument.create({
    data: {
      documentCode: 'INV-2026-660301',
      patientId: tanvir.id,
      type: 'BILLING_DOC',
      title: 'Medical Invoice — Full Body Checkup Executive Package',
      summary: 'Total: 10,000 BDT (PAID)',
      workspaceId: evercareHospital.id,
      workspaceNameSnapshot: 'Evercare Multidisciplinary Hospital',
      uploadedByMemberId: multiMember.id,
      structuredData: {
        invoiceNumber: 'INV-2026-660301',
        items: [
          {
            description: 'Full Body Checkup — Executive Wellness (PKG-2026-10001)',
            qty: 1,
            amount: 10000,
          },
        ],
        subtotal: 10000,
        discount: 0,
        totalAmount: 10000,
        currency: 'BDT',
        paymentStatus: 'PAID',
        paymentMethod: 'Digital Card / bKash',
        issuedByStaff: 'Sadia Afrin (Reception & Billing)',
        issuedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
      },
    },
  });

  // Vault Document for Senior Parent (Abdul Karim Ahmed)
  const seniorRx = await prisma.vaultDocument.create({
    data: {
      documentCode: 'RX-2026-880102',
      patientId: seniorKarim.id,
      type: 'PRESCRIPTION',
      title: 'Prescription — Osteoarthritis Knee & Postural Hypertension',
      summary: 'Calcium + Vitamin D3 | Physiotherapy & Knee Support',
      doctorId: drKamal.id,
      doctorNameSnapshot: 'Assoc. Prof. Dr. Kamal Hossain',
      workspaceId: squareClinic.id,
      workspaceNameSnapshot: 'Square Clinical & Orthopaedic Center',
      isImmutable: true,
      structuredData: {
        diagnosis: 'Bilateral Mild Knee Osteoarthritis',
        chiefComplaints: 'Right knee stiffness while climbing stairs.',
        vitals: { bp: '130/82 mmHg', pulse: '72 bpm', weight: '66 kg' },
        medications: [
          {
            name: 'Tab. Coralcal-D (Calcium 500mg + Vit D3)',
            dosage: '0 + 1 + 0',
            duration: '60 Days',
            instruction: 'After lunch',
          },
          {
            name: 'Tab. Napa Extend 665mg',
            dosage: '1 + 0 + 1',
            duration: '7 Days (SOS for pain)',
            instruction: 'After meal',
          },
        ],
        recommendedTests: ['Bilateral Knee X-Ray (Standing AP/Lateral)'],
        advice: 'Use knee cap during walking; avoid squatting or sitting cross-legged.',
        followUpDate: '2026-12-15',
      },
    },
  });

  // Vault Document for Child Account (Ayaan Ahmed)
  await prisma.vaultDocument.create({
    data: {
      documentCode: 'LAB-2026-770205',
      patientId: childAyaan.id,
      type: 'LAB_REPORT',
      title: 'Pediatric Vitamin D & Complete Blood Count',
      summary: 'Normal Pediatric Growth & Hematology Profile',
      workspaceId: popularDiagnostic.id,
      workspaceNameSnapshot: 'Popular Diagnostic & Imaging Center',
      structuredData: {
        testCategory: 'Pediatric Hematology',
        parameters: [
          {
            name: 'Hemoglobin',
            result: '12.6 g/dL',
            referenceRange: '11.5 - 15.5 g/dL',
            flag: 'NORMAL',
          },
          {
            name: '25-OH Vitamin D',
            result: '38 ng/mL',
            referenceRange: '30 - 100 ng/mL',
            flag: 'NORMAL',
          },
        ],
        conclusion: 'Healthy pediatric parameters.',
        verified: true,
      },
    },
  });

  // =========================================================================
  // 7. ACTIVE 2-HOUR QR SESSIONS STACKED IN DOCTOR'S QUEUE
  // =========================================================================
  // Session 1: Scanned 12 minutes ago (Senior Abdul Karim)
  await prisma.qrShareSession.create({
    data: {
      token: 'UMP-QR-demo-senior-karim-session-01',
      shortCode: 'QR-KARIM1',
      patientId: seniorKarim.id,
      createdByMaintainerId: tanvir.id,
      selectAll: true,
      documentIds: [seniorRx.id],
      scannedByDoctorId: drRahman.id,
      workspaceId: evercareHospital.id,
      status: 'SCANNED_ACTIVE',
      scannedAt: new Date(Date.now() - 12 * 60 * 1000),
      expiresAt: new Date(Date.now() + 108 * 60 * 1000),
    },
  });

  // Session 2: Scanned 2 minutes ago (Tanvir Ahmed — Stacked at the TOP of Dr. Rahman's queue!)
  await prisma.qrShareSession.create({
    data: {
      token: 'UMP-QR-demo-tanvir-ahmed-session-02',
      shortCode: 'QR-TANVIR',
      patientId: tanvir.id,
      selectAll: true,
      documentIds: [rx1.id, lab1.id, bill1.id],
      scannedByDoctorId: drRahman.id,
      workspaceId: evercareHospital.id,
      status: 'SCANNED_ACTIVE',
      scannedAt: new Date(Date.now() - 2 * 60 * 1000), // More recent -> Top of stack!
      expiresAt: new Date(Date.now() + 118 * 60 * 1000),
    },
  });

  // Session 3: Ready-to-scan unscanned QR code for live scanning demo (`QR-DEMO99`)
  await prisma.qrShareSession.create({
    data: {
      token: 'UMP-QR-live-demo-unscanned-99',
      shortCode: 'QR-DEMO99',
      patientId: childAyaan.id,
      createdByMaintainerId: tanvir.id,
      selectAll: true,
      documentIds: [],
      status: 'GENERATED',
      expiresAt: new Date(Date.now() + 120 * 60 * 1000),
    },
  });

  // =========================================================================
  // 8. APPOINTMENTS & IMMUTABLE WORKSPACE AUDIT LOGS (Including Removed Staff!)
  // =========================================================================
  await prisma.appointment.createMany({
    data: [
      {
        appointmentCode: 'APT-2026-300101',
        patientId: tanvir.id,
        doctorId: drRahman.id,
        workspaceId: evercareHospital.id,
        appointmentDate: '2026-11-12',
        timeSlot: '06:30 PM',
        reason: 'Follow-up review of Lipid Profile & BP monitoring',
        consultationFee: 1500,
        serialNumber: 4,
        status: 'APPROVED',
        managedByMemberId: multiMember.id,
        notes: 'Confirmed by Front Desk Coordinator Sadia Afrin.',
      },
      {
        appointmentCode: 'APT-2026-300102',
        patientId: seniorKarim.id,
        bookedByMaintainerId: tanvir.id,
        doctorId: drKamal.id,
        workspaceId: evercareHospital.id,
        appointmentDate: '2026-11-14',
        timeSlot: '11:00 AM',
        reason: 'Senior citizen knee pain evaluation',
        consultationFee: 1500,
        status: 'PENDING',
      },
    ],
  });

  // Audit logs showing active staff AND removed staff (Zahidul Karim) historical performance!
  await prisma.workspaceAuditLog.createMany({
    data: [
      {
        workspaceId: evercareHospital.id,
        actorMemberId: ownerMember.id,
        actorPatientId: evercareOwner.id,
        actorNameSnapshot: evercareOwner.name,
        actorRolesSnapshot: ['Owner'],
        action: 'HEALTH_PACKAGE_CREATED',
        category: 'PACKAGES',
        description:
          "Published promotional package 'Full Body Checkup — Executive Wellness' at 10,000 BDT",
        createdAt: new Date(Date.now() - 10 * 86400000),
      },
      {
        workspaceId: evercareHospital.id,
        actorMemberId: removedMember.id,
        actorPatientId: removedExStaff.id,
        actorNameSnapshot: removedExStaff.name,
        actorRolesSnapshot: ['Receptionist'],
        action: 'APPOINTMENT_APPROVED',
        category: 'APPOINTMENTS',
        description:
          'Approved 14 outpatient evening serials for Cardiology & Gynecology chambers (Historical Log of Removed Staff)',
        createdAt: new Date(Date.now() - 15 * 86400000),
      },
      {
        workspaceId: evercareHospital.id,
        actorMemberId: removedMember.id,
        actorPatientId: removedExStaff.id,
        actorNameSnapshot: removedExStaff.name,
        actorRolesSnapshot: ['Receptionist'],
        action: 'DOCTOR_SCHEDULE_UPDATED',
        category: 'DOCTORS',
        description:
          'Updated chamber room allocation for Orthopedic Wing (Historical Log of Removed Staff)',
        createdAt: new Date(Date.now() - 12 * 86400000),
      },
      {
        workspaceId: evercareHospital.id,
        actorMemberId: adminMember.id,
        actorPatientId: evercareAdmin.id,
        actorNameSnapshot: evercareAdmin.name,
        actorRolesSnapshot: ['Admin'],
        action: 'STAFF_REMOVED_HISTORY_PRESERVED',
        category: 'STAFF',
        description:
          'Removed Zahidul Karim (PAT-2026-200005) from active roster. All historical performance logs remain preserved.',
        createdAt: new Date(Date.now() - 5 * 86400000),
      },
      {
        workspaceId: evercareHospital.id,
        actorMemberId: labMember.id,
        actorPatientId: labTechStaff.id,
        actorNameSnapshot: labTechStaff.name,
        actorRolesSnapshot: ['Lab Technician'],
        action: 'LAB_REPORT_UPLOADED',
        category: 'REPORTS',
        description:
          'Uploaded & verified Comprehensive Lipid Profile & CBC Report (LAB-2026-770201) to Patient Tanvir Ahmed Vault',
        createdAt: new Date(Date.now() - 2 * 86400000),
      },
      {
        workspaceId: evercareHospital.id,
        actorMemberId: multiMember.id,
        actorPatientId: multiRoleStaff.id,
        actorNameSnapshot: multiRoleStaff.name,
        actorRolesSnapshot: ['Receptionist', 'Billing Officer'],
        action: 'BILLING_INVOICE_CREATED',
        category: 'BILLING',
        description:
          'Generated paid invoice INV-2026-660301 (10,000 BDT) for Full Body Checkup package and dispatched to Patient Vault',
        createdAt: new Date(Date.now() - 2 * 86400000),
      },
    ],
  });

  // =========================================================================
  // 9. NOTIFICATIONS & PATIENT ACTIVITY LOGS
  // =========================================================================
  await prisma.notification.createMany({
    data: [
      {
        recipientCentralRegistry: true,
        type: 'DGHS_DOCTOR_APPLICATION',
        title: `Pending Doctor Application — ${drPendingPatient.name} (DOC-2026-5004)`,
        message: `${drPendingPatient.name} (Neurology, BMDC-A-78410) submitted credentials for DGHS national license cross-check.`,
        metadata: {
          targetEntity: 'DOCTOR',
          targetId: drPendingProfile.id,
          doctorIdCode: 'DOC-2026-5004',
        },
        isRead: false,
      },
      {
        recipientCentralRegistry: true,
        type: 'DGHS_WORKSPACE_APPLICATION',
        title:
          'Pending Facility License — Green Life Specialized Hospital & Chamber (WSP-2026-9004)',
        message:
          'Green Life Specialized Hospital & Chamber (License: DGHS-HOSP-2026-099, Green Road, Dhaka) applied for DGHS institutional approval.',
        metadata: {
          targetEntity: 'WORKSPACE',
          targetId: pendingGreenLife.id,
          workspaceCode: 'WSP-2026-9004',
        },
        isRead: false,
      },
      {
        recipientCentralRegistry: true,
        type: 'DGHS_GOVERNANCE_AUDIT',
        title: 'National Health Vault & Ecosystem Compliance Sync',
        message:
          '3 Approved Facilities, 3 Approved Specialists, and 2 Family Proxy Relationships verified active across the national registry.',
        metadata: {
          targetEntity: 'OVERVIEW',
        },
        isRead: true,
      },
      {
        recipientPatientId: tanvir.id,
        type: 'PRESCRIPTION_RECEIVED',
        title: 'New Prescription from Prof. Dr. Mahbubur Rahman',
        message:
          'Prof. Dr. Mahbubur Rahman (Cardiology) sent prescription RX-2026-880101 to your Report & Prescription Vault.',
        isRead: false,
      },
      {
        recipientPatientId: tanvir.id,
        type: 'LAB_REPORT_READY',
        title: 'New Diagnostic Report from Evercare Multidisciplinary Hospital',
        message:
          'Your Comprehensive Lipid Profile & CBC Report (LAB-2026-770201) has been uploaded to your Vault.',
        isRead: false,
      },
      {
        recipientPatientId: tanvir.id,
        type: 'BILLING_INVOICE',
        title: 'New Billing Statement from Evercare Multidisciplinary Hospital',
        message:
          'Billing invoice INV-2026-660301 for 10,000 BDT (Full Body Checkup) has been added to your Vault.',
        isRead: false,
      },
      {
        recipientPatientId: tanvir.id,
        type: 'STAFF_INVITATION',
        title: 'Workspace Staff Invitation — Evercare Multidisciplinary Hospital',
        message:
          'You have been invited to join Evercare Multidisciplinary Hospital with role: Package & Marketing Coordinator.',
        isRead: false,
      },
      {
        recipientWorkspaceId: evercareHospital.id,
        requiredPermission: 'appointments.manage',
        type: 'APPOINTMENT_UPDATE',
        title: 'Pending Appointment Request — APT-2026-300102',
        message:
          'Senior patient Abdul Karim Ahmed requested an Orthopaedic appointment with Assoc. Prof. Dr. Kamal Hossain.',
        isRead: false,
      },
    ],
  });

  await prisma.patientActivityLog.createMany({
    data: [
      {
        patientId: tanvir.id,
        action: 'FAMILY_MAINTAINER_ACTIVE',
        description:
          'Managing Child account Ayaan Ahmed (PAT-2026-100002) and Senior account Abdul Karim Ahmed (PAT-2026-100003)',
      },
      {
        patientId: tanvir.id,
        action: 'PRESCRIPTION_RECEIVED',
        description:
          'Received prescription RX-2026-880101 from Prof. Dr. Mahbubur Rahman at Evercare Multidisciplinary Hospital',
      },
      {
        patientId: tanvir.id,
        action: 'REPORT_UPLOADED',
        description:
          'Diagnostic report LAB-2026-770201 uploaded to Vault by Evercare Multidisciplinary Hospital',
      },
      {
        patientId: tanvir.id,
        action: 'QR_SCANNED_BY_DOCTOR',
        description:
          '2-Hour QR code (QR-TANVIR) scanned by Prof. Dr. Mahbubur Rahman',
      },
    ],
  });

  console.log('[Seed] Demo database seeded successfully!');
}

if (require.main === module) {
  import('../src/scripts/ensure-postgres').then(async ({ ensureLocalPostgres }) => {
    await ensureLocalPostgres();
    await seedDatabase();
    await prisma.$disconnect();
  });
}
