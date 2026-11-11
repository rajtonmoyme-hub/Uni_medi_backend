import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import {
  DEFAULT_WORKSPACE_ROLE_TEMPLATES,
  ALL_PERMISSION_KEYS,
} from '../../config/permissions';
import {
  authenticateToken,
  authRateLimiter,
  signAuthToken,
} from '../../middleware/security';
import { sendOtpEmail } from '../../utils/mailer';

export const authRouter = Router();

function generateRandomCode(prefix: string): string {
  const num = Math.floor(100000 + Math.random() * 900000);
  return `${prefix}-2026-${num}`;
}

function generateSixDigitOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function buildFullUserContext(patientId: string) {
  const patient = await prisma.patientUser.findUnique({
    where: { id: patientId },
    include: {
      doctorProfile: {
        include: {
          workspaceAffiliations: {
            include: {
              workspace: {
                select: {
                  id: true,
                  workspaceCode: true,
                  name: true,
                  type: true,
                  area: true,
                  approvalStatus: true,
                },
              },
            },
          },
        },
      },
      workspaceMemberships: {
        where: {
          invitationStatus: { in: ['ACCEPTED', 'PENDING'] },
        },
        orderBy: { createdAt: 'asc' },
        include: {
          workspace: true,
          assignedRoles: {
            include: {
              role: true,
            },
          },
        },
      },
      maintainedDependents: {
        include: {
          dependent: {
            select: {
              id: true,
              uniqueId: true,
              name: true,
              email: true,
              phone: true,
              accountType: true,
              bloodGroup: true,
              gender: true,
              dateOfBirth: true,
              profileAvatar: true,
              status: true,
            },
          },
        },
      },
      managedByMaintainers: {
        include: {
          maintainer: {
            select: {
              id: true,
              uniqueId: true,
              name: true,
              email: true,
              phone: true,
            },
          },
        },
      },
    },
  });

  if (!patient) return null;

  const activeWorkspaces = patient.workspaceMemberships
    .filter((m) => m.invitationStatus === 'ACCEPTED')
    .map((m) => {
      const permSet = new Set<string>();
      const roleNames: string[] = [];
      if (m.isOwner) {
        roleNames.push('Owner');
        ALL_PERMISSION_KEYS.forEach((k) => permSet.add(k));
      }
      if (m.isAdmin && !roleNames.includes('Admin')) {
        roleNames.push('Admin');
        ALL_PERMISSION_KEYS.forEach((k) => permSet.add(k));
      }
      for (const ar of m.assignedRoles) {
        if (!roleNames.includes(ar.role.name)) {
          roleNames.push(ar.role.name);
        }
        ar.role.permissions.forEach((p) => permSet.add(p));
      }

      return {
        memberId: m.id,
        workspaceId: m.workspaceId,
        workspaceCode: m.workspace.workspaceCode,
        workspaceName: m.workspace.name,
        workspaceType: m.workspace.type,
        approvalStatus: m.workspace.approvalStatus,
        area: m.workspace.area,
        isOwner: m.isOwner,
        isAdmin: m.isAdmin,
        staffTitle: m.staffTitle,
        department: m.department,
        roles: m.assignedRoles.map((ar) => ({
          id: ar.role.id,
          name: ar.role.name,
          permissions: ar.role.permissions,
        })),
        roleNames,
        combinedPermissions: Array.from(permSet),
      };
    });

  const pendingStaffInvites = patient.workspaceMemberships
    .filter((m) => m.invitationStatus === 'PENDING')
    .map((m) => ({
      memberId: m.id,
      workspaceId: m.workspaceId,
      workspaceName: m.workspace.name,
      workspaceType: m.workspace.type,
      staffTitle: m.staffTitle,
      department: m.department,
      roles: m.assignedRoles.map((ar) => ar.role.name),
      createdAt: m.createdAt,
    }));

  const { passwordHash, otpCode, ...safePatient } = patient;

  return {
    isCentralRegistry: false,
    patient: safePatient,
    doctorProfile: patient.doctorProfile,
    workspaces: activeWorkspaces,
    pendingStaffInvites,
    maintainedDependents: patient.maintainedDependents,
    managedByMaintainers: patient.managedByMaintainers,
  };
}

// 1. Patient Registration with OTP & Optional Child/Old Family Link
authRouter.post(
  '/patient/register',
  authRateLimiter,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        name,
        email,
        phone,
        password,
        accountType = 'NORMAL',
        maintainerIdentifier,
        relationshipLabel,
        bloodGroup,
        gender,
        dateOfBirth,
        address,
        nationalId,
      } = req.body;

      if (!name || !email || !phone || !password) {
        res.status(400).json({
          error: 'Name, email, phone, and password are required.',
        });
        return;
      }

      const normalizedEmail = String(email).trim().toLowerCase();
      const normalizedPhone = String(phone).trim();

      const existing = await prisma.patientUser.findFirst({
        where: {
          OR: [{ email: normalizedEmail }, { phone: normalizedPhone }],
        },
      });

      if (existing) {
        res.status(409).json({
          error: 'An account with this email or phone number already exists.',
        });
        return;
      }

      const passwordHash = await bcrypt.hash(String(password), 10);
      const uniqueId = generateRandomCode('PAT');
      const otpCode = generateSixDigitOtp();
      const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

      const validAccountType = ['NORMAL', 'CHILD', 'OLD'].includes(accountType)
        ? accountType
        : 'NORMAL';

      const createdPatient = await prisma.patientUser.create({
        data: {
          uniqueId,
          name: String(name).trim(),
          email: normalizedEmail,
          phone: normalizedPhone,
          passwordHash,
          accountType: validAccountType as any,
          nationalId: nationalId ? String(nationalId).trim() : null,
          bloodGroup: bloodGroup || null,
          gender: gender || null,
          dateOfBirth: dateOfBirth || null,
          address: address || null,
          isOtpVerified: false,
          otpCode,
          otpExpiresAt,
        },
      });

      await prisma.patientActivityLog.create({
        data: {
          patientId: createdPatient.id,
          action: 'ACCOUNT_REGISTERED',
          description: `Patient account (${validAccountType}) created with ID ${uniqueId}`,
        },
      });

      // If registering as CHILD or OLD and specifying a Maintainer account
      let familyLinkCreated = null;
      if (
        (validAccountType === 'CHILD' || validAccountType === 'OLD') &&
        maintainerIdentifier
      ) {
        const cleanId = String(maintainerIdentifier).trim();
        const maintainer = await prisma.patientUser.findFirst({
          where: {
            OR: [
              { uniqueId: cleanId },
              { email: cleanId.toLowerCase() },
              { phone: cleanId },
            ],
          },
        });

        if (maintainer && maintainer.id !== createdPatient.id) {
          familyLinkCreated = await prisma.familyRelationship.create({
            data: {
              maintainerId: maintainer.id,
              dependentId: createdPatient.id,
              relationshipType: validAccountType as any,
              relationshipLabel:
                relationshipLabel ||
                (validAccountType === 'CHILD' ? 'Child Dependent' : 'Senior Parent'),
              initiatedBy: 'DEPENDENT',
              status: 'PENDING',
            },
          });

          await prisma.notification.create({
            data: {
              recipientPatientId: maintainer.id,
              type: 'FAMILY_INVITATION',
              title: 'New Family Account Maintainer Request',
              message: `${createdPatient.name} (${createdPatient.uniqueId}) registered as a ${validAccountType} account and requested you as their Family Maintainer.`,
              metadata: { familyRelationshipId: familyLinkCreated.id },
            },
          });
        }
      }

      const mailResult = await sendOtpEmail(
        normalizedEmail,
        createdPatient.name,
        otpCode,
        uniqueId
      );

      res.status(201).json({
        message:
          'Patient registered successfully. Please verify your account with the 6-digit OTP sent to your email.',
        uniqueId: createdPatient.uniqueId,
        patientId: createdPatient.id,
        email: createdPatient.email,
        phone: createdPatient.phone,
        requiresOtp: true,
        sentViaSmtp: mailResult.sentViaSmtp,
        demoOtpHint: mailResult.demoOtpHint,
        familyLinkCreated,
      });
    } catch (err: any) {
      res.status(500).json({
        error: 'Failed to register patient account',
        details: err?.message,
      });
    }
  }
);

// 2. Verify Patient OTP
authRouter.post(
  '/patient/verify-otp',
  authRateLimiter,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { identifier, otpCode } = req.body;
      if (!identifier || !otpCode) {
        res.status(400).json({ error: 'Identifier and OTP code are required.' });
        return;
      }

      const cleanId = String(identifier).trim();
      const patient = await prisma.patientUser.findFirst({
        where: {
          OR: [
            { email: cleanId.toLowerCase() },
            { phone: cleanId },
            { uniqueId: cleanId },
            { id: cleanId },
          ],
        },
      });

      if (!patient) {
        res.status(404).json({ error: 'Patient account not found.' });
        return;
      }

      if (patient.isOtpVerified) {
        const token = signAuthToken({
          patientId: patient.id,
          uniqueId: patient.uniqueId,
          email: patient.email,
          name: patient.name,
          isCentralRegistry: false,
        });
        const context = await buildFullUserContext(patient.id);
        res.json({
          message: 'Account is already verified.',
          token,
          user: context,
        });
        return;
      }

      if (
        !patient.otpCode ||
        patient.otpCode !== String(otpCode).trim() ||
        (patient.otpExpiresAt && patient.otpExpiresAt < new Date())
      ) {
        res.status(400).json({
          error: 'Invalid or expired OTP code. Please check and try again.',
        });
        return;
      }

      await prisma.patientUser.update({
        where: { id: patient.id },
        data: {
          isOtpVerified: true,
          otpCode: null,
          otpExpiresAt: null,
        },
      });

      await prisma.patientActivityLog.create({
        data: {
          patientId: patient.id,
          action: 'OTP_VERIFIED',
          description: 'Patient verified their account via OTP',
        },
      });

      const token = signAuthToken({
        patientId: patient.id,
        uniqueId: patient.uniqueId,
        email: patient.email,
        name: patient.name,
        isCentralRegistry: false,
      });

      const context = await buildFullUserContext(patient.id);

      res.json({
        message: 'OTP verified successfully. Welcome to the Unified Health Platform!',
        token,
        user: context,
      });
    } catch (err: any) {
      res.status(500).json({
        error: 'Failed to verify OTP',
        details: err?.message,
      });
    }
  }
);

// 3. Resend OTP
authRouter.post(
  '/patient/resend-otp',
  authRateLimiter,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { identifier } = req.body;
      if (!identifier) {
        res.status(400).json({ error: 'Email, phone, or Unique ID is required.' });
        return;
      }

      const cleanId = String(identifier).trim();
      const patient = await prisma.patientUser.findFirst({
        where: {
          OR: [
            { email: cleanId.toLowerCase() },
            { phone: cleanId },
            { uniqueId: cleanId },
          ],
        },
      });

      if (!patient) {
        res.status(404).json({ error: 'Patient account not found.' });
        return;
      }

      const otpCode = generateSixDigitOtp();
      const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

      await prisma.patientUser.update({
        where: { id: patient.id },
        data: { otpCode, otpExpiresAt },
      });

      const mailResult = await sendOtpEmail(
        patient.email,
        patient.name,
        otpCode,
        patient.uniqueId
      );

      res.json({
        message: 'A new 6-digit OTP has been sent to your email.',
        sentViaSmtp: mailResult.sentViaSmtp,
        demoOtpHint: mailResult.demoOtpHint,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to resend OTP' });
    }
  }
);

// 4. Doctor Registration (Auto-creates or links mandatory Patient account + submits to DGHS)
authRouter.post(
  '/doctor/register',
  authRateLimiter,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        name,
        email,
        phone,
        password,
        doctorLicense,
        nationalId,
        specialty,
        degrees,
        achievements,
        bio,
        area,
        experienceYears,
        defaultConsultationFee,
        profileImage,
      } = req.body;

      if (
        !name ||
        !email ||
        !phone ||
        !password ||
        !doctorLicense ||
        !nationalId ||
        !specialty
      ) {
        res.status(400).json({
          error:
            'Name, email, phone, password, doctor_license, national_id, and specialty are required.',
        });
        return;
      }

      const normalizedEmail = String(email).trim().toLowerCase();
      const normalizedPhone = String(phone).trim();
      const normalizedLicense = String(doctorLicense).trim();
      const normalizedNid = String(nationalId).trim();

      const existingLicense = await prisma.doctorProfile.findUnique({
        where: { doctorLicense: normalizedLicense },
      });

      if (existingLicense) {
        res.status(409).json({
          error: 'A Doctor with this Medical License / BMDC ID already exists.',
        });
        return;
      }

      // Check if Patient account already exists or auto-create one
      let patient = await prisma.patientUser.findFirst({
        where: {
          OR: [{ email: normalizedEmail }, { phone: normalizedPhone }],
        },
        include: { doctorProfile: true },
      });

      if (patient) {
        if (patient.doctorProfile) {
          res.status(409).json({
            error: 'This account already has a registered Doctor profile.',
          });
          return;
        }
        if (!patient.nationalId) {
          patient = await prisma.patientUser.update({
            where: { id: patient.id },
            data: { nationalId: normalizedNid, isOtpVerified: true },
            include: { doctorProfile: true },
          });
        }
      } else {
        const passwordHash = await bcrypt.hash(String(password), 10);
        const uniqueId = generateRandomCode('PAT');
        patient = await prisma.patientUser.create({
          data: {
            uniqueId,
            name: String(name).trim(),
            email: normalizedEmail,
            phone: normalizedPhone,
            passwordHash,
            nationalId: normalizedNid,
            isOtpVerified: true,
            accountType: 'NORMAL',
          },
          include: { doctorProfile: true },
        });

        await prisma.patientActivityLog.create({
          data: {
            patientId: patient.id,
            action: 'ACCOUNT_AUTO_CREATED_FROM_DOCTOR',
            description: `Base Patient account (${uniqueId}) automatically created during Doctor registration`,
          },
        });
      }

      const doctorIdCode = generateRandomCode('DOC');
      const parsedDegrees = Array.isArray(degrees)
        ? degrees
        : typeof degrees === 'string' && degrees.trim()
          ? degrees.split(',').map((s: string) => s.trim())
          : ['MBBS'];

      const parsedAchievements = Array.isArray(achievements)
        ? achievements
        : typeof achievements === 'string' && achievements.trim()
          ? achievements.split(',').map((s: string) => s.trim())
          : [];

      const doctorProfile = await prisma.doctorProfile.create({
        data: {
          doctorIdCode,
          patientUserId: patient.id,
          doctorLicense: normalizedLicense,
          nationalId: normalizedNid,
          specialty: String(specialty).trim(),
          degrees: parsedDegrees,
          achievements: parsedAchievements,
          bio: bio || 'Committed to patient-centered evidence-based healthcare.',
          area: area || 'Dhaka, Bangladesh',
          experienceYears: Number(experienceYears) || 5,
          defaultConsultationFee: Number(defaultConsultationFee) || 1000,
          profileImage: profileImage || null,
          approvalStatus: 'PENDING',
        },
      });

      await prisma.notification.create({
        data: {
          recipientPatientId: patient.id,
          recipientDoctorId: doctorProfile.id,
          type: 'DGHS_STATUS_CHANGE',
          title: 'Doctor Application Submitted to Central Registry (DGHS)',
          message: `Your Doctor registration (${doctorIdCode}, License: ${normalizedLicense}) is pending DGHS verification. Meanwhile, your linked Patient account (${patient.uniqueId}) is active and accessible via the navbar switcher.`,
        },
      });

      await prisma.notification.create({
        data: {
          recipientCentralRegistry: true,
          type: 'DGHS_DOCTOR_APPLICATION',
          title: `New Doctor Registration: ${patient.name} (${doctorIdCode})`,
          message: `${patient.name} applied for DGHS verification as ${doctorProfile.specialty} (BMDC: ${normalizedLicense}, NID: ${normalizedNid}).`,
          metadata: {
            targetEntity: 'DOCTOR',
            targetId: doctorProfile.id,
            doctorIdCode,
          },
        },
      });

      const token = signAuthToken({
        patientId: patient.id,
        uniqueId: patient.uniqueId,
        email: patient.email,
        name: patient.name,
        isCentralRegistry: false,
        doctorId: doctorProfile.id,
      });

      const context = await buildFullUserContext(patient.id);

      res.status(201).json({
        message:
          'Doctor registration submitted for Central Registry (DGHS) approval. Your linked Patient account has also been created automatically.',
        token,
        user: context,
      });
    } catch (err: any) {
      res.status(500).json({
        error: 'Failed to register Doctor application',
        details: err?.message,
      });
    }
  }
);

// 5. Workspace / Hospital Registration (Option A: Auto-creates or links Single Primary Owner's Patient account)
authRouter.post(
  '/workspace/register',
  authRateLimiter,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        workspaceName,
        type = 'HOSPITAL',
        registrationLicense,
        workspaceEmail,
        workspacePhone,
        address,
        area,
        description,
        departments,
        operatingHours,
        logoUrl,
        bannerUrl,
        // Owner details (Option A)
        ownerName,
        ownerEmail,
        ownerPhone,
        ownerPassword,
        ownerNationalId,
      } = req.body;

      if (
        !workspaceName ||
        !registrationLicense ||
        !address ||
        !area ||
        !ownerEmail ||
        !ownerPassword
      ) {
        res.status(400).json({
          error:
            'Workspace name, registration license, address, area, and Owner credentials are required.',
        });
        return;
      }

      const normalizedLicense = String(registrationLicense).trim();
      const existingWorkspace = await prisma.workspace.findUnique({
        where: { registrationLicense: normalizedLicense },
      });

      if (existingWorkspace) {
        res.status(409).json({
          error: 'A Hospital/Workspace with this Registration License already exists.',
        });
        return;
      }

      const normalizedOwnerEmail = String(ownerEmail).trim().toLowerCase();
      const normalizedOwnerPhone = String(ownerPhone || workspacePhone || '').trim();

      let ownerPatient = await prisma.patientUser.findFirst({
        where: {
          OR: [
            { email: normalizedOwnerEmail },
            ...(normalizedOwnerPhone ? [{ phone: normalizedOwnerPhone }] : []),
          ],
        },
      });

      if (ownerPatient) {
        const validPass = await bcrypt.compare(
          String(ownerPassword),
          ownerPatient.passwordHash
        );
        if (!validPass) {
          res.status(401).json({
            error:
              'An existing Patient account was found for the Owner email/phone, but the provided password did not match.',
          });
          return;
        }
      } else {
        if (!ownerName || !normalizedOwnerPhone) {
          res.status(400).json({
            error:
              'Owner Name and Phone are required to automatically create the Owner Patient account.',
          });
          return;
        }
        const passwordHash = await bcrypt.hash(String(ownerPassword), 10);
        const uniqueId = generateRandomCode('PAT');
        ownerPatient = await prisma.patientUser.create({
          data: {
            uniqueId,
            name: String(ownerName).trim(),
            email: normalizedOwnerEmail,
            phone: normalizedOwnerPhone,
            passwordHash,
            nationalId: ownerNationalId ? String(ownerNationalId).trim() : null,
            isOtpVerified: true,
            accountType: 'NORMAL',
          },
        });

        await prisma.patientActivityLog.create({
          data: {
            patientId: ownerPatient.id,
            action: 'ACCOUNT_AUTO_CREATED_FROM_WORKSPACE',
            description: `Base Patient account (${uniqueId}) automatically created during Workspace registration`,
          },
        });
      }

      const workspaceCode = generateRandomCode('WSP');
      const parsedDepartments = Array.isArray(departments)
        ? departments
        : typeof departments === 'string' && departments.trim()
          ? departments.split(',').map((d: string) => d.trim())
          : ['General Medicine', 'Pathology & Diagnostics', 'Outpatient Care'];

      const workspace = await prisma.workspace.create({
        data: {
          workspaceCode,
          name: String(workspaceName).trim(),
          type: ['HOSPITAL', 'CLINIC', 'DIAGNOSTIC_CENTER', 'CHAMBER'].includes(type)
            ? (type as any)
            : 'HOSPITAL',
          registrationLicense: normalizedLicense,
          ownerPatientId: ownerPatient.id,
          email: String(workspaceEmail || normalizedOwnerEmail).trim().toLowerCase(),
          phone: String(workspacePhone || normalizedOwnerPhone).trim(),
          address: String(address).trim(),
          area: String(area).trim(),
          description:
            description ||
            'Comprehensive multidisciplinary healthcare & diagnostic facility.',
          departments: parsedDepartments,
          operatingHours:
            operatingHours || '24/7 Emergency & Outpatient 8:00 AM - 10:00 PM',
          logoUrl: logoUrl || null,
          bannerUrl: bannerUrl || null,
          approvalStatus: 'PENDING',
        },
      });

      // Seed default system & operational roles for the new workspace
      const createdRoles = await Promise.all(
        DEFAULT_WORKSPACE_ROLE_TEMPLATES.map((tpl) =>
          prisma.workspaceRole.create({
            data: {
              workspaceId: workspace.id,
              name: tpl.name,
              description: tpl.description,
              isSystemRole: tpl.isSystemRole,
              permissions: tpl.permissions,
            },
          })
        )
      );

      const ownerRole = createdRoles.find((r) => r.name === 'Owner')!;

      const ownerMember = await prisma.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          patientUserId: ownerPatient.id,
          isOwner: true,
          isAdmin: true,
          staffTitle: 'Primary Founder & Owner',
          department: 'Executive Governance',
          invitationStatus: 'ACCEPTED',
          joinedAt: new Date(),
        },
      });

      await prisma.workspaceMemberRole.create({
        data: {
          memberId: ownerMember.id,
          roleId: ownerRole.id,
        },
      });

      await prisma.workspaceAuditLog.create({
        data: {
          workspaceId: workspace.id,
          actorMemberId: ownerMember.id,
          actorPatientId: ownerPatient.id,
          actorNameSnapshot: ownerPatient.name,
          actorRolesSnapshot: ['Owner'],
          action: 'WORKSPACE_REGISTERED',
          category: 'GOVERNANCE',
          targetType: 'WORKSPACE',
          targetId: workspace.id,
          description: `Workspace '${workspace.name}' (${workspace.workspaceCode}) registered by Single Owner ${ownerPatient.name} (${ownerPatient.uniqueId}) and submitted to DGHS.`,
        },
      });

      await prisma.notification.create({
        data: {
          recipientCentralRegistry: true,
          type: 'DGHS_WORKSPACE_APPLICATION',
          title: `New Facility Registration: ${workspace.name} (${workspace.workspaceCode})`,
          message: `${workspace.name} (${workspace.type}, License: ${normalizedLicense}) in ${workspace.area} applied for DGHS approval (Owner: ${ownerPatient.name}).`,
          metadata: {
            targetEntity: 'WORKSPACE',
            targetId: workspace.id,
            workspaceCode: workspace.workspaceCode,
          },
        },
      });

      const token = signAuthToken({
        patientId: ownerPatient.id,
        uniqueId: ownerPatient.uniqueId,
        email: ownerPatient.email,
        name: ownerPatient.name,
        isCentralRegistry: false,
      });

      const context = await buildFullUserContext(ownerPatient.id);

      res.status(201).json({
        message:
          'Hospital/Workspace registration submitted for Central Registry (DGHS) approval.',
        token,
        workspace,
        user: context,
      });
    } catch (err: any) {
      res.status(500).json({
        error: 'Failed to register Workspace',
        details: err?.message,
      });
    }
  }
);

// 6. Unified Login (Supports Central Registry via .env + Patient / Doctor / Workspace via Email, Phone, or Unique ID)
authRouter.post(
  '/login',
  authRateLimiter,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { identifier, password } = req.body;
      if (!identifier || !password) {
        res.status(400).json({
          error: 'Email/Phone/ID and password are required.',
        });
        return;
      }

      const cleanId = String(identifier).trim();

      // Check Central Registry (.env configured credentials)
      if (
        (cleanId.toLowerCase() === env.CENTRAL_REGISTRY.EMAIL.toLowerCase() ||
          cleanId === env.CENTRAL_REGISTRY.CODE ||
          cleanId === env.CENTRAL_REGISTRY.PHONE) &&
        String(password) === env.CENTRAL_REGISTRY.PASSWORD
      ) {
        const token = signAuthToken({
          email: env.CENTRAL_REGISTRY.EMAIL,
          name: env.CENTRAL_REGISTRY.NAME,
          isCentralRegistry: true,
        });

        res.json({
          message: 'Authenticated as Central Registry (DGHS).',
          token,
          user: {
            isCentralRegistry: true,
            centralRegistry: {
              name: env.CENTRAL_REGISTRY.NAME,
              email: env.CENTRAL_REGISTRY.EMAIL,
              code: env.CENTRAL_REGISTRY.CODE,
              phone: env.CENTRAL_REGISTRY.PHONE,
            },
          },
        });
        return;
      }

      // Lookup PatientUser by primary email, phone, uniqueId, or secondary emails/phones
      const patient = await prisma.patientUser.findFirst({
        where: {
          OR: [
            { email: cleanId.toLowerCase() },
            { phone: cleanId },
            { uniqueId: cleanId },
            { secondaryEmails: { has: cleanId.toLowerCase() } },
            { secondaryPhones: { has: cleanId } },
          ],
        },
      });

      if (!patient) {
        res.status(401).json({
          error: 'Invalid credentials. No account found matching that email or phone.',
        });
        return;
      }

      if (patient.status === 'DISABLED') {
        res.status(403).json({
          error:
            'Your account has been disabled by the Central Registry (DGHS). Please contact DGHS administration.',
          code: 'ACCOUNT_DISABLED',
        });
        return;
      }

      const validPassword = await bcrypt.compare(
        String(password),
        patient.passwordHash
      );

      if (!validPassword) {
        res.status(401).json({ error: 'Invalid password. Please try again.' });
        return;
      }

      if (!patient.isOtpVerified) {
        res.status(403).json({
          error: 'Please verify your account with the 6-digit OTP before logging in.',
          requiresOtp: true,
          email: patient.email,
          uniqueId: patient.uniqueId,
          demoOtpHint: env.DEMO_MODE ? patient.otpCode : undefined,
        });
        return;
      }

      const context = await buildFullUserContext(patient.id);
      const token = signAuthToken({
        patientId: patient.id,
        uniqueId: patient.uniqueId,
        email: patient.email,
        name: patient.name,
        isCentralRegistry: false,
        doctorId: context?.doctorProfile?.id,
      });

      res.json({
        message: 'Login successful.',
        token,
        user: context,
      });
    } catch (err: any) {
      res.status(500).json({
        error: 'Login failed',
        details: err?.message,
      });
    }
  }
);

// 7. Get Current Authenticated User Context (For Navbar Account Switcher & Role Synchronization)
authRouter.get(
  '/me',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (req.user?.isCentralRegistry) {
        res.json({
          user: {
            isCentralRegistry: true,
            centralRegistry: {
              name: env.CENTRAL_REGISTRY.NAME,
              email: env.CENTRAL_REGISTRY.EMAIL,
              code: env.CENTRAL_REGISTRY.CODE,
              phone: env.CENTRAL_REGISTRY.PHONE,
            },
          },
        });
        return;
      }

      if (!req.user?.patientId) {
        res.status(401).json({ error: 'Invalid session' });
        return;
      }

      const context = await buildFullUserContext(req.user.patientId);
      if (!context) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      res.json({ user: context });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to load user context' });
    }
  }
);
