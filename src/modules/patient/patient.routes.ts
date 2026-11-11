import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import QRCode from 'qrcode';
import { prisma } from '../../config/prisma';
import { authenticateToken, qrRateLimiter } from '../../middleware/security';

export const patientRouter = Router();

patientRouter.use(authenticateToken);

async function resolveTargetPatientId(
  req: Request
): Promise<{ targetPatientId: string; isProxy: boolean; error?: string }> {
  const selfId = req.user?.patientId;
  if (!selfId) {
    return { targetPatientId: '', isProxy: false, error: 'Patient identity required' };
  }

  const requestedId =
    (req.headers['x-acting-patient-id'] as string) ||
    (req.query.actingPatientId as string) ||
    req.body?.actingPatientId;

  if (!requestedId || requestedId === selfId) {
    return { targetPatientId: selfId, isProxy: false };
  }

  // Verify Maintainer has an ACTIVE FamilyRelationship with this dependent
  const relation = await prisma.familyRelationship.findUnique({
    where: {
      maintainerId_dependentId: {
        maintainerId: selfId,
        dependentId: String(requestedId),
      },
    },
  });

  if (!relation || relation.status !== 'ACTIVE') {
    return {
      targetPatientId: '',
      isProxy: true,
      error:
        'Forbidden: You do not have active Family Maintainer proxy access for this account.',
    };
  }

  return { targetPatientId: String(requestedId), isProxy: true };
}

// 1. Patient Dashboard (Includes Top Featured Hospital Packages, Vault Summary, Upcoming Appointments, Active QR Shares, Family Accounts)
patientRouter.get(
  '/dashboard',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const resolved = await resolveTargetPatientId(req);
      if (resolved.error) {
        res.status(403).json({ error: resolved.error });
        return;
      }

      const patientId = resolved.targetPatientId;

      const [
        patient,
        featuredPackages,
        recentVaultDocs,
        upcomingAppointments,
        activeQrSessions,
        familyDependents,
        familyMaintainers,
        pendingStaffInvites,
      ] = await Promise.all([
        prisma.patientUser.findUnique({
          where: { id: patientId },
          select: {
            id: true,
            uniqueId: true,
            name: true,
            email: true,
            phone: true,
            secondaryEmails: true,
            secondaryPhones: true,
            nationalId: true,
            profileAvatar: true,
            accountType: true,
            bloodGroup: true,
            gender: true,
            dateOfBirth: true,
            address: true,
            emergencyContact: true,
            status: true,
            createdAt: true,
          },
        }),
        prisma.healthPackage.findMany({
          where: {
            isActive: true,
            workspace: { approvalStatus: 'APPROVED' },
          },
          orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }],
          include: {
            workspace: {
              select: {
                id: true,
                workspaceCode: true,
                name: true,
                type: true,
                area: true,
                address: true,
                phone: true,
                logoUrl: true,
              },
            },
          },
          take: 8,
        }),
        prisma.vaultDocument.findMany({
          where: { patientId },
          orderBy: { createdAt: 'desc' },
          take: 6,
          include: {
            doctor: {
              include: {
                patientUser: { select: { name: true } },
              },
            },
            workspace: {
              select: { id: true, name: true, type: true },
            },
          },
        }),
        prisma.appointment.findMany({
          where: { patientId },
          orderBy: { createdAt: 'desc' },
          take: 6,
          include: {
            doctor: {
              include: {
                patientUser: { select: { name: true } },
              },
            },
            workspace: {
              select: { id: true, name: true, area: true, address: true },
            },
          },
        }),
        prisma.qrShareSession.findMany({
          where: {
            patientId,
            status: { in: ['GENERATED', 'SCANNED_ACTIVE'] },
            expiresAt: { gt: new Date() },
          },
          orderBy: { createdAt: 'desc' },
          include: {
            scannedByDoctor: {
              include: {
                patientUser: { select: { name: true } },
              },
            },
          },
        }),
        prisma.familyRelationship.findMany({
          where: { maintainerId: patientId },
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
                dateOfBirth: true,
                status: true,
              },
            },
          },
        }),
        prisma.familyRelationship.findMany({
          where: { dependentId: patientId },
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
        }),
        prisma.workspaceMember.findMany({
          where: {
            patientUserId: patientId,
            invitationStatus: 'PENDING',
          },
          include: {
            workspace: {
              select: { id: true, name: true, type: true, area: true },
            },
            assignedRoles: {
              include: { role: { select: { id: true, name: true } } },
            },
          },
        }),
      ]);

      res.json({
        isProxySession: resolved.isProxy,
        patient,
        featuredPackages,
        recentVaultDocs,
        upcomingAppointments,
        activeQrSessions,
        familyDependents,
        familyMaintainers,
        pendingStaffInvites,
      });
    } catch (err: any) {
      res.status(500).json({
        error: 'Failed to load patient dashboard',
        details: err?.message,
      });
    }
  }
);

// 2. Patient Report / Prescription / Billing Vault (Filter & Sort by Doctor Name, Workspace Name, Type)
patientRouter.get(
  '/vault',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const resolved = await resolveTargetPatientId(req);
      if (resolved.error) {
        res.status(403).json({ error: resolved.error });
        return;
      }

      const { doctorName, workspaceName, type, sortBy = 'date_desc' } = req.query;

      const where: any = {
        patientId: resolved.targetPatientId,
      };

      if (
        type &&
        ['PRESCRIPTION', 'LAB_REPORT', 'BILLING_DOC'].includes(String(type))
      ) {
        where.type = String(type);
      }

      if (doctorName && String(doctorName).trim()) {
        const dq = String(doctorName).trim();
        where.OR = [
          { doctorNameSnapshot: { contains: dq, mode: 'insensitive' } },
          {
            doctor: {
              patientUser: { name: { contains: dq, mode: 'insensitive' } },
            },
          },
        ];
      }

      if (workspaceName && String(workspaceName).trim()) {
        const wq = String(workspaceName).trim();
        where.AND = [
          ...(where.AND || []),
          {
            OR: [
              { workspaceNameSnapshot: { contains: wq, mode: 'insensitive' } },
              { workspace: { name: { contains: wq, mode: 'insensitive' } } },
            ],
          },
        ];
      }

      let orderBy: any = { createdAt: 'desc' };
      if (sortBy === 'date_asc') orderBy = { createdAt: 'asc' };
      if (sortBy === 'doctor') orderBy = { doctorNameSnapshot: 'asc' };
      if (sortBy === 'workspace') orderBy = { workspaceNameSnapshot: 'asc' };

      const documents = await prisma.vaultDocument.findMany({
        where,
        orderBy,
        include: {
          doctor: {
            include: {
              patientUser: {
                select: { name: true, email: true, phone: true },
              },
            },
          },
          workspace: {
            select: {
              id: true,
              workspaceCode: true,
              name: true,
              type: true,
              area: true,
            },
          },
        },
      });

      res.json({ documents });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to load Vault documents' });
    }
  }
);

// 3. Generate 2-Hour Temporary QR Code for Selected (or All) Vault Prescriptions/Reports
patientRouter.post(
  '/vault/qr-generate',
  qrRateLimiter,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const resolved = await resolveTargetPatientId(req);
      if (resolved.error) {
        res.status(403).json({ error: resolved.error });
        return;
      }

      const patientId = resolved.targetPatientId;
      const { selectAll = false, documentIds = [] } = req.body;

      let finalDocIds: string[] = [];

      if (selectAll) {
        const allDocs = await prisma.vaultDocument.findMany({
          where: { patientId },
          select: { id: true },
        });
        finalDocIds = allDocs.map((d) => d.id);
      } else if (Array.isArray(documentIds) && documentIds.length > 0) {
        const validDocs = await prisma.vaultDocument.findMany({
          where: {
            patientId,
            id: { in: documentIds.map(String) },
          },
          select: { id: true },
        });
        finalDocIds = validDocs.map((d) => d.id);
      } else {
        // Even if patient has 0 previous documents (new patient visiting a doctor), allow generating a QR session so the Doctor can scan and issue their first prescription!
        finalDocIds = [];
      }

      const token = `UMP-QR-${crypto.randomBytes(16).toString('hex')}`;
      const shortCode = `QR-${crypto
        .randomBytes(3)
        .toString('hex')
        .toUpperCase()}`;
      const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // Strictly 2 hours

      const session = await prisma.qrShareSession.create({
        data: {
          token,
          shortCode,
          patientId,
          createdByMaintainerId: resolved.isProxy ? req.user?.patientId : null,
          selectAll: Boolean(selectAll),
          documentIds: finalDocIds,
          status: 'GENERATED',
          expiresAt,
        },
        include: {
          patient: {
            select: {
              id: true,
              uniqueId: true,
              name: true,
              accountType: true,
            },
          },
        },
      });

      const qrPayload = JSON.stringify({
        platform: 'UNIFIED_MEDI',
        token: session.token,
        shortCode: session.shortCode,
        patientUniqueId: session.patient.uniqueId,
        patientName: session.patient.name,
        expiresAt: session.expiresAt.toISOString(),
      });

      const qrDataUrl = await QRCode.toDataURL(qrPayload, {
        width: 300,
        margin: 2,
        color: {
          dark: '#005830',
          light: '#ffffff',
        },
      });

      await prisma.patientActivityLog.create({
        data: {
          patientId,
          actorPatientId: req.user?.patientId,
          action: 'QR_GENERATED',
          description: `Generated 2-hour QR code (${shortCode}) sharing ${finalDocIds.length} document(s)`,
        },
      });

      res.status(201).json({
        message: '2-Hour QR Code generated successfully.',
        session,
        qrDataUrl,
        qrPayload,
      });
    } catch (err: any) {
      res.status(500).json({
        error: 'Failed to generate QR code',
        details: err?.message,
      });
    }
  }
);

// 4. List Active & Past QR Sessions for Patient
patientRouter.get(
  '/vault/qr-sessions',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const resolved = await resolveTargetPatientId(req);
      if (resolved.error) {
        res.status(403).json({ error: resolved.error });
        return;
      }

      const sessions = await prisma.qrShareSession.findMany({
        where: { patientId: resolved.targetPatientId },
        orderBy: { createdAt: 'desc' },
        take: 25,
        include: {
          scannedByDoctor: {
            include: {
              patientUser: { select: { name: true, email: true, phone: true } },
            },
          },
          workspace: {
            select: { id: true, name: true, workspaceCode: true },
          },
        },
      });

      res.json({ sessions });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to list QR sessions' });
    }
  }
);

// 5. Patient Revokes QR Session Access Immediately
patientRouter.post(
  '/vault/qr-sessions/:id/revoke',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const resolved = await resolveTargetPatientId(req);
      if (resolved.error) {
        res.status(403).json({ error: resolved.error });
        return;
      }

      const session = await prisma.qrShareSession.findFirst({
        where: {
          id: String(req.params.id),
          patientId: resolved.targetPatientId,
        },
      });

      if (!session) {
        res.status(404).json({ error: 'QR session not found' });
        return;
      }

      const updated = await prisma.qrShareSession.update({
        where: { id: session.id },
        data: {
          status: 'REVOKED_BY_PATIENT',
          revokedAt: new Date(),
        },
      });

      await prisma.patientActivityLog.create({
        data: {
          patientId: resolved.targetPatientId,
          actorPatientId: req.user?.patientId,
          action: 'QR_REVOKED',
          description: `Revoked Doctor access for QR code ${session.shortCode}`,
        },
      });

      res.json({
        message: 'Doctor access to this QR session has been revoked immediately.',
        session: updated,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to revoke QR session' });
    }
  }
);

// 6. Find a Doctor Directory (Search by Doctor Name, Workspace Name, Specialty/Type, Area/Location)
patientRouter.get(
  '/doctors',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { search, workspaceName, specialty, area } = req.query;

      const where: any = {
        approvalStatus: 'APPROVED',
        patientUser: { status: 'ACTIVE' },
      };

      if (specialty && String(specialty).trim()) {
        where.specialty = {
          contains: String(specialty).trim(),
          mode: 'insensitive',
        };
      }

      if (area && String(area).trim()) {
        where.area = {
          contains: String(area).trim(),
          mode: 'insensitive',
        };
      }

      if (search && String(search).trim()) {
        const q = String(search).trim();
        where.OR = [
          { patientUser: { name: { contains: q, mode: 'insensitive' } } },
          { specialty: { contains: q, mode: 'insensitive' } },
          { doctorIdCode: { contains: q, mode: 'insensitive' } },
          { area: { contains: q, mode: 'insensitive' } },
          {
            workspaceAffiliations: {
              some: {
                status: 'ACTIVE',
                workspace: { name: { contains: q, mode: 'insensitive' } },
              },
            },
          },
        ];
      }

      if (workspaceName && String(workspaceName).trim()) {
        where.workspaceAffiliations = {
          some: {
            status: 'ACTIVE',
            workspace: {
              name: { contains: String(workspaceName).trim(), mode: 'insensitive' },
            },
          },
        };
      }

      const rawDoctors = await prisma.doctorProfile.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          patientUser: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              profileAvatar: true,
            },
          },
          workspaceAffiliations: {
            where: {
              status: 'ACTIVE',
              workspace: { approvalStatus: 'APPROVED' },
            },
            include: {
              workspace: {
                select: {
                  id: true,
                  workspaceCode: true,
                  name: true,
                  type: true,
                  area: true,
                  address: true,
                  phone: true,
                },
              },
            },
          },
        },
      });

      // Respect Doctor's profileVisibility customization settings
      const doctors = rawDoctors.map((doc) => {
        const vis = (doc.profileVisibility as Record<string, any>) || {
          showDegrees: true,
          showAchievements: true,
          showBio: true,
          showPhoto: true,
          showExperience: true,
        };

        return {
          id: doc.id,
          doctorIdCode: doc.doctorIdCode,
          name: doc.patientUser.name,
          specialty: doc.specialty,
          area: doc.area,
          defaultConsultationFee: doc.defaultConsultationFee,
          degrees: vis.showDegrees !== false ? doc.degrees : [],
          achievements: vis.showAchievements !== false ? doc.achievements : [],
          bio: vis.showBio !== false ? doc.bio : null,
          experienceYears:
            vis.showExperience !== false ? doc.experienceYears : null,
          profileImage:
            vis.showPhoto !== false
              ? doc.profileImage || doc.patientUser.profileAvatar
              : null,
          customHeadline: vis.customHeadline || null,
          affiliations: doc.workspaceAffiliations.map((aff) => ({
            affiliationId: aff.id,
            workspaceId: aff.workspace.id,
            workspaceCode: aff.workspace.workspaceCode,
            workspaceName: aff.workspace.name,
            workspaceType: aff.workspace.type,
            area: aff.workspace.area,
            address: aff.workspace.address,
            consultationFee: aff.consultationFee,
            schedule: aff.schedule,
            roomNumber: aff.roomNumber,
          })),
        };
      });

      res.json({ doctors });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to search doctors' });
    }
  }
);

// 7. Apply for Appointment with a Doctor at a Chosen Affiliated Workspace
patientRouter.post(
  '/appointments',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const resolved = await resolveTargetPatientId(req);
      if (resolved.error) {
        res.status(403).json({ error: resolved.error });
        return;
      }

      const {
        doctorId,
        workspaceId,
        appointmentDate,
        timeSlot,
        reason,
      } = req.body;

      if (!doctorId || !appointmentDate || !timeSlot) {
        res.status(400).json({
          error:
            'doctorId, appointmentDate, and timeSlot are required.',
        });
        return;
      }

      const isIndependent =
        !workspaceId || String(workspaceId) === 'INDEPENDENT_CHAMBER';

      let targetWorkspaceId: string | null = null;
      let targetFee = 1000;
      let doctorName = 'Doctor';
      let doctorPatientUserId: string | null = null;
      let facilityLabel = 'Independent Personal Chamber';

      if (isIndependent) {
        const doctor = await prisma.doctorProfile.findFirst({
          where: {
            id: String(doctorId),
            approvalStatus: 'APPROVED',
          },
          include: {
            patientUser: { select: { id: true, name: true } },
          },
        });

        if (!doctor) {
          res.status(404).json({
            error: 'Approved Doctor not found.',
          });
          return;
        }

        targetWorkspaceId = null;
        targetFee = doctor.defaultConsultationFee || 1000;
        doctorName = doctor.patientUser.name;
        doctorPatientUserId = doctor.patientUser.id;
      } else {
        const affiliation = await prisma.doctorWorkspaceAffiliation.findFirst({
          where: {
            doctorId: String(doctorId),
            workspaceId: String(workspaceId),
            status: 'ACTIVE',
          },
          include: {
            doctor: {
              include: { patientUser: { select: { id: true, name: true } } },
            },
            workspace: true,
          },
        });

        if (!affiliation) {
          res.status(400).json({
            error:
              'The selected Doctor is not actively affiliated with the chosen Hospital/Workspace.',
          });
          return;
        }

        targetWorkspaceId = affiliation.workspaceId;
        targetFee = affiliation.consultationFee;
        doctorName = affiliation.doctor.patientUser.name;
        doctorPatientUserId = affiliation.doctor.patientUser.id;
        facilityLabel = affiliation.workspace.name;
      }

      const appointmentCode = `APT-2026-${Math.floor(100000 + Math.random() * 900000)}`;

      const appointment = await prisma.appointment.create({
        data: {
          appointmentCode,
          patientId: resolved.targetPatientId,
          bookedByMaintainerId: resolved.isProxy ? req.user?.patientId : null,
          doctorId: String(doctorId),
          workspaceId: targetWorkspaceId,
          appointmentDate: String(appointmentDate),
          timeSlot: String(timeSlot),
          reason: reason || 'General Consultation',
          consultationFee: targetFee,
          status: 'PENDING',
        },
        include: {
          doctor: {
            include: { patientUser: { select: { name: true } } },
          },
          workspace: {
            select: { id: true, name: true, area: true },
          },
        },
      });

      await prisma.patientActivityLog.create({
        data: {
          patientId: resolved.targetPatientId,
          actorPatientId: req.user?.patientId,
          action: 'APPOINTMENT_REQUESTED',
          description: `Requested appointment (${appointmentCode}) with ${doctorName} at ${facilityLabel}`,
        },
      });

      if (targetWorkspaceId) {
        // Notify Workspace Staff with 'appointments.manage' permission
        await prisma.notification.create({
          data: {
            recipientWorkspaceId: targetWorkspaceId,
            requiredPermission: 'appointments.manage',
            type: 'APPOINTMENT_UPDATE',
            title: 'New Patient Appointment Request',
            message: `Appointment ${appointmentCode} requested for ${doctorName} on ${appointmentDate} (${timeSlot}). Awaiting Workspace Staff approval.`,
            metadata: { appointmentId: appointment.id },
          },
        });
      } else {
        // Notify Independent Doctor directly
        await prisma.notification.create({
          data: {
            recipientPatientId: doctorPatientUserId,
            recipientDoctorId: String(doctorId),
            type: 'APPOINTMENT_UPDATE',
            title: 'New Independent Chamber Appointment Request',
            message: `Appointment ${appointmentCode} requested for your Independent Chamber on ${appointmentDate} (${timeSlot}).`,
            metadata: { appointmentId: appointment.id },
          },
        });
      }

      res.status(201).json({
        message: targetWorkspaceId
          ? 'Appointment request submitted! Workspace Front Desk staff will confirm your slot.'
          : 'Independent Chamber appointment request submitted successfully!',
        appointment,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to create appointment request' });
    }
  }
);

// 8. List Patient Appointments
patientRouter.get(
  '/appointments',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const resolved = await resolveTargetPatientId(req);
      if (resolved.error) {
        res.status(403).json({ error: resolved.error });
        return;
      }

      const appointments = await prisma.appointment.findMany({
        where: { patientId: resolved.targetPatientId },
        orderBy: { createdAt: 'desc' },
        include: {
          doctor: {
            include: {
              patientUser: { select: { name: true, phone: true } },
            },
          },
          workspace: {
            select: {
              id: true,
              workspaceCode: true,
              name: true,
              type: true,
              area: true,
              address: true,
              phone: true,
            },
          },
        },
      });

      res.json({ appointments });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to load appointments' });
    }
  }
);

// 9. Workspace / Hospital Directory & Packages (Search & Sort by Location/Area, Name, Type)
patientRouter.get(
  '/workspaces',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { search, area, type, sortBy = 'name_asc' } = req.query;

      const where: any = {
        approvalStatus: 'APPROVED',
      };

      if (
        type &&
        ['HOSPITAL', 'CLINIC', 'DIAGNOSTIC_CENTER', 'CHAMBER'].includes(
          String(type)
        )
      ) {
        where.type = String(type);
      }

      if (area && String(area).trim()) {
        where.area = {
          contains: String(area).trim(),
          mode: 'insensitive',
        };
      }

      if (search && String(search).trim()) {
        const q = String(search).trim();
        where.OR = [
          { name: { contains: q, mode: 'insensitive' } },
          { area: { contains: q, mode: 'insensitive' } },
          { address: { contains: q, mode: 'insensitive' } },
          { departments: { has: q } },
        ];
      }

      let orderBy: any = { name: 'asc' };
      if (sortBy === 'name_desc') orderBy = { name: 'desc' };
      if (sortBy === 'area') orderBy = { area: 'asc' };
      if (sortBy === 'newest') orderBy = { createdAt: 'desc' };

      const [workspaces, featuredPackages] = await Promise.all([
        prisma.workspace.findMany({
          where,
          orderBy,
          include: {
            packages: {
              where: { isActive: true },
              orderBy: { price: 'asc' },
            },
            doctorAffiliations: {
              where: { status: 'ACTIVE' },
              include: {
                doctor: {
                  include: {
                    patientUser: { select: { name: true } },
                  },
                },
              },
            },
          },
        }),
        prisma.healthPackage.findMany({
          where: {
            isActive: true,
            workspace: { approvalStatus: 'APPROVED' },
          },
          orderBy: [{ isFeatured: 'desc' }, { price: 'asc' }],
          include: {
            workspace: {
              select: {
                id: true,
                workspaceCode: true,
                name: true,
                type: true,
                area: true,
                address: true,
                phone: true,
              },
            },
          },
        }),
      ]);

      res.json({
        featuredPackages,
        workspaces,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to load workspaces and packages' });
    }
  }
);

// 10. Patient Profile Configuration (Update Avatar, Name, Phone, Password, Multiple Emails & Numbers, Optional NID)
patientRouter.patch(
  '/profile',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const resolved = await resolveTargetPatientId(req);
      if (resolved.error) {
        res.status(403).json({ error: resolved.error });
        return;
      }

      const patientId = resolved.targetPatientId;
      const {
        name,
        phone,
        newPassword,
        profileAvatar,
        nationalId,
        secondaryEmails,
        secondaryPhones,
        bloodGroup,
        gender,
        dateOfBirth,
        address,
        emergencyContact,
      } = req.body;

      const updateData: any = {};

      if (name !== undefined) updateData.name = String(name).trim();
      if (phone !== undefined) updateData.phone = String(phone).trim();
      if (profileAvatar !== undefined) updateData.profileAvatar = profileAvatar;
      if (nationalId !== undefined && String(nationalId).trim()) {
        updateData.nationalId = String(nationalId).trim();
      }
      if (Array.isArray(secondaryEmails)) {
        updateData.secondaryEmails = secondaryEmails
          .map((e: string) => String(e).trim().toLowerCase())
          .filter(Boolean);
      }
      if (Array.isArray(secondaryPhones)) {
        updateData.secondaryPhones = secondaryPhones
          .map((p: string) => String(p).trim())
          .filter(Boolean);
      }
      if (bloodGroup !== undefined) updateData.bloodGroup = bloodGroup;
      if (gender !== undefined) updateData.gender = gender;
      if (dateOfBirth !== undefined) updateData.dateOfBirth = dateOfBirth;
      if (address !== undefined) updateData.address = address;
      if (emergencyContact !== undefined)
        updateData.emergencyContact = emergencyContact;

      if (newPassword && String(newPassword).trim().length >= 6) {
        updateData.passwordHash = await bcrypt.hash(
          String(newPassword).trim(),
          10
        );
      }

      const updated = await prisma.patientUser.update({
        where: { id: patientId },
        data: updateData,
      });

      const { passwordHash, otpCode, ...safePatient } = updated;

      res.json({
        message: 'Patient profile updated successfully.',
        patient: safePatient,
      });
    } catch (err: any) {
      res.status(500).json({
        error: 'Failed to update patient profile',
        details: err?.message,
      });
    }
  }
);

// 11. Family Section — View Family Relationships (Maintained Dependents & Managing Maintainers)
patientRouter.get(
  '/family',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const patientId = req.user!.patientId!;
      const [maintainedDependents, managedByMaintainers] = await Promise.all([
        prisma.familyRelationship.findMany({
          where: { maintainerId: patientId },
          orderBy: { createdAt: 'desc' },
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
                _count: {
                  select: {
                    vaultDocuments: true,
                    appointments: true,
                  },
                },
              },
            },
          },
        }),
        prisma.familyRelationship.findMany({
          where: { dependentId: patientId },
          orderBy: { createdAt: 'desc' },
          include: {
            maintainer: {
              select: {
                id: true,
                uniqueId: true,
                name: true,
                email: true,
                phone: true,
                accountType: true,
              },
            },
          },
        }),
      ]);

      res.json({
        maintainedDependents,
        managedByMaintainers,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to load family relationships' });
    }
  }
);

// 12. Family Section — Send Invitation (Maintainer invites Child/Old account OR Child/Old links Maintainer)
patientRouter.post(
  '/family/invite',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const selfId = req.user!.patientId!;
      const {
        targetIdentifier,
        direction = 'AS_MAINTAINER', // 'AS_MAINTAINER' (I am maintainer inviting a child/old) or 'AS_DEPENDENT' (I am child/old adding a maintainer)
        relationshipType = 'CHILD',
        relationshipLabel = 'Family Member',
      } = req.body;

      if (!targetIdentifier) {
        res.status(400).json({
          error:
            'Please provide the Patient Unique ID, Email, or Phone of the family member.',
        });
        return;
      }

      const cleanId = String(targetIdentifier).trim();
      const targetUser = await prisma.patientUser.findFirst({
        where: {
          OR: [
            { uniqueId: cleanId },
            { email: cleanId.toLowerCase() },
            { phone: cleanId },
          ],
        },
      });

      if (!targetUser) {
        res.status(404).json({
          error:
            'No registered Patient account found with that Unique ID, Email, or Phone. Remember that a Patient account is mandatory first.',
        });
        return;
      }

      if (targetUser.id === selfId) {
        res.status(400).json({ error: 'Cannot link your own account.' });
        return;
      }

      const maintainerId =
        direction === 'AS_DEPENDENT' ? targetUser.id : selfId;
      const dependentId =
        direction === 'AS_DEPENDENT' ? selfId : targetUser.id;
      const initiatedBy =
        direction === 'AS_DEPENDENT' ? 'DEPENDENT' : 'MAINTAINER';

      const validRelType = ['CHILD', 'OLD'].includes(relationshipType)
        ? relationshipType
        : 'CHILD';

      // Ensure dependent accountType reflects CHILD or OLD
      if (direction === 'AS_MAINTAINER' && targetUser.accountType === 'NORMAL') {
        await prisma.patientUser.update({
          where: { id: targetUser.id },
          data: { accountType: validRelType as any },
        });
      }

      const link = await prisma.familyRelationship.upsert({
        where: {
          maintainerId_dependentId: {
            maintainerId,
            dependentId,
          },
        },
        update: {
          relationshipType: validRelType as any,
          relationshipLabel,
          initiatedBy,
          status: 'PENDING',
        },
        create: {
          maintainerId,
          dependentId,
          relationshipType: validRelType as any,
          relationshipLabel,
          initiatedBy,
          status: 'PENDING',
        },
        include: {
          maintainer: { select: { id: true, uniqueId: true, name: true } },
          dependent: {
            select: {
              id: true,
              uniqueId: true,
              name: true,
              accountType: true,
            },
          },
        },
      });

      await prisma.notification.create({
        data: {
          recipientPatientId: targetUser.id,
          type: 'FAMILY_INVITATION',
          title: 'Family Account Linkage Invitation',
          message:
            direction === 'AS_MAINTAINER'
              ? `${req.user?.name} (${req.user?.uniqueId}) sent you an invitation to manage your account as a Family Maintainer (${relationshipLabel}).`
              : `${req.user?.name} (${req.user?.uniqueId}) requested you to be their Family Account Maintainer (${relationshipLabel}).`,
          metadata: { familyRelationshipId: link.id },
        },
      });

      res.status(201).json({
        message: 'Family linkage invitation sent.',
        relationship: link,
      });
    } catch (err: any) {
      res.status(500).json({
        error: 'Failed to create family invitation',
        details: err?.message,
      });
    }
  }
);

// 13. Family Section — Enable / Accept ('ACTIVE') or Revoke ('REVOKED') Family Maintainer Link (Both Maintainer & Dependent can toggle!)
patientRouter.patch(
  '/family/:id/status',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const selfId = req.user!.patientId!;
      const { status } = req.body;

      if (!['ACTIVE', 'REVOKED'].includes(status)) {
        res.status(400).json({ error: 'status must be ACTIVE or REVOKED' });
        return;
      }

      const rel = await prisma.familyRelationship.findUnique({
        where: { id: String(req.params.id) },
      });

      if (!rel || (rel.maintainerId !== selfId && rel.dependentId !== selfId)) {
        res.status(404).json({ error: 'Family relationship not found' });
        return;
      }

      const updated = await prisma.familyRelationship.update({
        where: { id: rel.id },
        data: { status },
        include: {
          maintainer: { select: { id: true, uniqueId: true, name: true } },
          dependent: {
            select: { id: true, uniqueId: true, name: true, accountType: true },
          },
        },
      });

      await prisma.patientActivityLog.create({
        data: {
          patientId: rel.dependentId,
          actorPatientId: selfId,
          action: `FAMILY_LINK_${status}`,
          description: `Family maintainer relationship between ${updated.maintainer.name} and ${updated.dependent.name} set to ${status}`,
        },
      });

      const otherPartyId =
        rel.maintainerId === selfId ? rel.dependentId : rel.maintainerId;

      await prisma.notification.create({
        data: {
          recipientPatientId: otherPartyId,
          type: 'FAMILY_INVITATION',
          title: `Family Maintainer Link ${status === 'ACTIVE' ? 'Enabled' : 'Revoked'}`,
          message: `${req.user?.name} has ${status === 'ACTIVE' ? 'enabled/accepted' : 'revoked'} the family maintainer connection (${updated.relationshipLabel}).`,
        },
      });

      res.json({
        message: `Family maintainer relationship is now ${status}.`,
        relationship: updated,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to update family relationship' });
    }
  }
);

// 14. Workspace Staff Invitations — View & Respond (Accept or Revoke)
patientRouter.get(
  '/staff-invitations',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const invitations = await prisma.workspaceMember.findMany({
        where: {
          patientUserId: req.user!.patientId!,
          invitationStatus: { in: ['PENDING', 'ACCEPTED', 'REVOKED'] },
        },
        include: {
          workspace: {
            select: {
              id: true,
              workspaceCode: true,
              name: true,
              type: true,
              area: true,
              address: true,
            },
          },
          assignedRoles: {
            include: {
              role: {
                select: {
                  id: true,
                  name: true,
                  description: true,
                  permissions: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      res.json({ invitations });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to load staff invitations' });
    }
  }
);

patientRouter.patch(
  '/staff-invitations/:memberId/respond',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { action } = req.body; // 'ACCEPT' or 'REVOKE'
      if (!['ACCEPT', 'REVOKE'].includes(action)) {
        res.status(400).json({ error: 'action must be ACCEPT or REVOKE' });
        return;
      }

      const member = await prisma.workspaceMember.findFirst({
        where: {
          id: String(req.params.memberId),
          patientUserId: req.user!.patientId!,
        },
        include: {
          workspace: true,
          assignedRoles: { include: { role: true } },
        },
      });

      if (!member) {
        res.status(404).json({ error: 'Staff invitation not found' });
        return;
      }

      if (member.isOwner) {
        res.status(400).json({
          error:
            'Primary Workspace Owner cannot revoke their own ownership via staff invitation.',
        });
        return;
      }

      const newStatus = action === 'ACCEPT' ? 'ACCEPTED' : 'REVOKED';

      const updated = await prisma.workspaceMember.update({
        where: { id: member.id },
        data: {
          invitationStatus: newStatus,
          joinedAt: action === 'ACCEPT' ? new Date() : member.joinedAt,
        },
      });

      const auditLog = await prisma.workspaceAuditLog.create({
        data: {
          workspaceId: member.workspaceId,
          actorMemberId: member.id,
          actorPatientId: req.user!.patientId!,
          actorNameSnapshot: req.user!.name,
          actorRolesSnapshot: member.assignedRoles.map((r) => r.role.name),
          action: `STAFF_INVITATION_${newStatus}`,
          category: 'STAFF',
          targetType: 'MEMBER',
          targetId: member.id,
          description: `${req.user!.name} (${req.user!.uniqueId}) ${newStatus.toLowerCase()} their staff role assignment (${member.assignedRoles.map((r) => r.role.name).join(', ')}) at ${member.workspace.name}.`,
        },
      });

      if (process.env.NODE_ENV !== 'test') {
        console.info(
          `[WORKSPACE_AUDIT_LOG] [${auditLog.action}] Workspace=${member.workspace.workspaceCode} Actor="${req.user!.name}" -> ${auditLog.description}`
        );
      }

      await prisma.notification.create({
        data: {
          recipientWorkspaceId: member.workspaceId,
          requiredPermission: 'staff.view',
          type: 'STAFF_INVITATION_RESPONSE',
          title: `Staff Invitation ${newStatus === 'ACCEPTED' ? 'Accepted' : 'Revoked'}`,
          message: `${req.user!.name} (${req.user!.uniqueId}) ${newStatus.toLowerCase()} the staff invitation (${member.assignedRoles.map((r) => r.role.name).join(', ')}).`,
          metadata: { memberId: member.id, status: newStatus },
        },
      });

      res.json({
        message: `Workspace staff invitation ${newStatus.toLowerCase()}.`,
        membership: updated,
        auditLog,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to respond to staff invitation' });
    }
  }
);
