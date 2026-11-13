import { Router, Request, Response } from 'express';
import { prisma } from '../../config/prisma';
import {
  authenticateToken,
  qrRateLimiter,
  requireApprovedDoctor,
} from '../../middleware/security';
import {
  parseScheduleAndSlots,
  formatScheduleWithSlots,
  getIndependentChamberConfig,
} from '../../utils/scheduleSlots';

export const doctorRouter = Router();

doctorRouter.use(authenticateToken);

// 1. Doctor Dashboard & Profile Status (Accessible even while PENDING so Doctor can see their DGHS status and customize profile)
doctorRouter.get(
  '/dashboard',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const doctor = await prisma.doctorProfile.findUnique({
        where: { patientUserId: req.user!.patientId! },
        include: {
          patientUser: {
            select: {
              id: true,
              uniqueId: true,
              name: true,
              email: true,
              phone: true,
              nationalId: true,
              profileAvatar: true,
            },
          },
          workspaceAffiliations: {
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
                  approvalStatus: true,
                },
              },
            },
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      if (!doctor) {
        res.status(404).json({ error: 'No Doctor profile found for this user.' });
        return;
      }

      const now = new Date();

      const [activeQrQueue, totalPrescriptions, totalAppointments, recentHistory] =
        await Promise.all([
          prisma.qrShareSession.findMany({
            where: {
              scannedByDoctorId: doctor.id,
              status: 'SCANNED_ACTIVE',
              expiresAt: { gt: now },
            },
            orderBy: { scannedAt: 'desc' }, // Most recently scanned patient at the top of the stack!
            include: {
              patient: {
                select: {
                  id: true,
                  uniqueId: true,
                  name: true,
                  email: true,
                  phone: true,
                  bloodGroup: true,
                  gender: true,
                  dateOfBirth: true,
                  accountType: true,
                },
              },
              workspace: {
                select: { id: true, name: true, workspaceCode: true },
              },
            },
          }),
          prisma.vaultDocument.count({
            where: { doctorId: doctor.id, type: 'PRESCRIPTION' },
          }),
          prisma.appointment.count({
            where: { doctorId: doctor.id },
          }),
          prisma.vaultDocument.findMany({
            where: { doctorId: doctor.id, type: 'PRESCRIPTION' },
            orderBy: { createdAt: 'desc' },
            take: 8,
            include: {
              patient: {
                select: {
                  id: true,
                  uniqueId: true,
                  name: true,
                  phone: true,
                },
              },
              workspace: {
                select: { id: true, name: true, workspaceCode: true },
              },
            },
          }),
        ]);

      const indepConfig = getIndependentChamberConfig(doctor.profileVisibility);
      const enrichedAffiliations = doctor.workspaceAffiliations.map((aff) => {
        const parsed = parseScheduleAndSlots(aff.schedule);
        return {
          ...aff,
          scheduleLabel: parsed.scheduleLabel,
          availableSlots: parsed.availableSlots,
        };
      });

      res.json({
        doctor: {
          ...doctor,
          independentSchedule: indepConfig.independentSchedule,
          independentSlots: indepConfig.independentSlots,
          workspaceAffiliations: enrichedAffiliations,
        },
        metrics: {
          activeQrStackCount: activeQrQueue.length,
          totalPrescriptionsIssued: totalPrescriptions,
          totalAppointments,
          activeWorkspacesCount: doctor.workspaceAffiliations.filter(
            (a) => a.status === 'ACTIVE'
          ).length,
        },
        activeQrQueue,
        recentHistory,
      });
    } catch (err: any) {
      res.status(500).json({
        error: 'Failed to load Doctor dashboard',
        details: err?.message,
      });
    }
  }
);

// 2. Scan Patient QR Code (Accepts QR token, 6-char shortCode, or JSON payload from QR scanner)
doctorRouter.post(
  '/qr/scan',
  requireApprovedDoctor,
  qrRateLimiter,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const doctorId = req.user!.doctorId!;
      const { qrInput, workspaceId } = req.body;

      if (!qrInput) {
        res.status(400).json({
          error: 'Please provide the scanned QR token, payload, or 6-character code.',
        });
        return;
      }

      let lookupTokenOrCode = String(qrInput).trim();

      // If input is JSON string from QR camera scanner, parse it
      if (lookupTokenOrCode.startsWith('{')) {
        try {
          const parsed = JSON.parse(lookupTokenOrCode);
          lookupTokenOrCode = parsed.token || parsed.shortCode || lookupTokenOrCode;
        } catch {
          // Use raw string
        }
      }

      const session = await prisma.qrShareSession.findFirst({
        where: {
          OR: [
            { token: lookupTokenOrCode },
            { shortCode: lookupTokenOrCode.toUpperCase() },
          ],
        },
        include: {
          patient: {
            select: {
              id: true,
              uniqueId: true,
              name: true,
              email: true,
              phone: true,
              bloodGroup: true,
              gender: true,
              dateOfBirth: true,
              accountType: true,
              address: true,
            },
          },
        },
      });

      if (!session) {
        res.status(404).json({
          error: 'Invalid QR Code. No matching Patient QR session was found.',
        });
        return;
      }

      if (session.status === 'REVOKED_BY_PATIENT') {
        res.status(403).json({
          error: 'This QR code has been revoked by the patient.',
        });
        return;
      }

      if (session.expiresAt <= new Date()) {
        await prisma.qrShareSession.update({
          where: { id: session.id },
          data: { status: 'EXPIRED' },
        });
        res.status(410).json({
          error:
            'This QR code has expired (2-hour window elapsed). Please ask the patient to generate a fresh QR code.',
        });
        return;
      }

      // Activate & stack at the TOP of the Doctor's queue by updating scannedAt = new Date()
      const updatedSession = await prisma.qrShareSession.update({
        where: { id: session.id },
        data: {
          scannedByDoctorId: doctorId,
          workspaceId: workspaceId ? String(workspaceId) : session.workspaceId,
          status: 'SCANNED_ACTIVE',
          scannedAt: new Date(),
        },
        include: {
          patient: {
            select: {
              id: true,
              uniqueId: true,
              name: true,
              email: true,
              phone: true,
              bloodGroup: true,
              gender: true,
              dateOfBirth: true,
              accountType: true,
              address: true,
            },
          },
          workspace: {
            select: { id: true, name: true, workspaceCode: true },
          },
        },
      });

      // Fetch the permitted Vault documents for this QR session
      const sharedDocuments = await prisma.vaultDocument.findMany({
        where: {
          patientId: session.patientId,
          ...(session.selectAll ? {} : { id: { in: session.documentIds } }),
        },
        orderBy: { createdAt: 'desc' },
        include: {
          doctor: {
            include: { patientUser: { select: { name: true } } },
          },
          workspace: {
            select: { id: true, name: true },
          },
        },
      });

      await prisma.patientActivityLog.create({
        data: {
          patientId: session.patientId,
          action: 'QR_SCANNED_BY_DOCTOR',
          description: `QR session ${session.shortCode} scanned by Dr. ${req.user?.name}`,
        },
      });

      res.json({
        message: `Patient ${updatedSession.patient.name} (${updatedSession.patient.uniqueId}) added to the top of your active consultation queue.`,
        session: {
          ...updatedSession,
          sharedDocuments,
        },
      });
    } catch (err: any) {
      res.status(500).json({
        error: 'Failed to scan Patient QR code',
        details: err?.message,
      });
    }
  }
);

// 3. Get Doctor's Active Scanned Patient Stack (Most recent scan stacked at the top!)
doctorRouter.get(
  '/qr/queue',
  requireApprovedDoctor,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const doctorId = req.user!.doctorId!;
      const now = new Date();

      const activeSessions = await prisma.qrShareSession.findMany({
        where: {
          scannedByDoctorId: doctorId,
          status: 'SCANNED_ACTIVE',
          expiresAt: { gt: now },
        },
        orderBy: { scannedAt: 'desc' }, // Strictly most recent at the top!
        include: {
          patient: {
            select: {
              id: true,
              uniqueId: true,
              name: true,
              email: true,
              phone: true,
              bloodGroup: true,
              gender: true,
              dateOfBirth: true,
              accountType: true,
              address: true,
            },
          },
          workspace: {
            select: { id: true, name: true, workspaceCode: true },
          },
        },
      });

      // Attach shared documents for each queued patient session
      const queueWithDocs = await Promise.all(
        activeSessions.map(async (s) => {
          const sharedDocuments = await prisma.vaultDocument.findMany({
            where: {
              patientId: s.patientId,
              ...(s.selectAll ? {} : { id: { in: s.documentIds } }),
            },
            orderBy: { createdAt: 'desc' },
            include: {
              doctor: {
                include: { patientUser: { select: { name: true } } },
              },
              workspace: {
                select: { id: true, name: true },
              },
            },
          });

          // Also include prescriptions previously issued by THIS doctor to this patient (lifetime access)
          const myPastPrescriptions = await prisma.vaultDocument.findMany({
            where: {
              patientId: s.patientId,
              doctorId,
              type: 'PRESCRIPTION',
            },
            orderBy: { createdAt: 'desc' },
          });

          return {
            ...s,
            sharedDocuments,
            myPastPrescriptions,
          };
        })
      );

      res.json({ queue: queueWithDocs });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to load Doctor QR patient queue' });
    }
  }
);

// 4. Remove / Dismiss Patient from Doctor's Active QR Queue
doctorRouter.post(
  '/qr/queue/:sessionId/dismiss',
  requireApprovedDoctor,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const doctorId = req.user!.doctorId!;
      const session = await prisma.qrShareSession.findFirst({
        where: {
          id: String(req.params.sessionId),
          scannedByDoctorId: doctorId,
        },
      });

      if (!session) {
        res.status(404).json({ error: 'QR queue session not found' });
        return;
      }

      const updated = await prisma.qrShareSession.update({
        where: { id: session.id },
        data: { status: 'DISMISSED_BY_DOCTOR' },
      });

      res.json({
        message: 'Patient removed from your active consultation queue.',
        session: updated,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to remove patient from queue' });
    }
  }
);

// 5. Issue Immutable Prescription (Decision 7a: STRICTLY requires an active scanned QR session!)
doctorRouter.post(
  '/prescriptions',
  requireApprovedDoctor,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const doctorId = req.user!.doctorId!;
      const {
        qrSessionId,
        workspaceId,
        title,
        diagnosis,
        chiefComplaints,
        vitals,
        medications,
        recommendedTests,
        advice,
        followUpDate,
      } = req.body;

      if (!qrSessionId) {
        res.status(403).json({
          error:
            'Strict Security Policy: A Doctor can issue a prescription strictly ONLY after scanning an active Patient QR code (qrSessionId required).',
          code: 'QR_SCAN_REQUIRED',
        });
        return;
      }

      const qrSession = await prisma.qrShareSession.findFirst({
        where: {
          id: String(qrSessionId),
          scannedByDoctorId: doctorId,
        },
        include: {
          patient: true,
        },
      });

      if (!qrSession) {
        res.status(403).json({
          error:
            'No active QR scan session found for this patient under your Doctor account.',
          code: 'INVALID_QR_SESSION',
        });
        return;
      }

      if (qrSession.status !== 'SCANNED_ACTIVE') {
        res.status(403).json({
          error: `Cannot issue prescription: QR session status is ${qrSession.status}.`,
          code: 'QR_SESSION_INACTIVE',
        });
        return;
      }

      if (qrSession.expiresAt <= new Date()) {
        res.status(403).json({
          error:
            'Cannot issue prescription: The 2-hour QR access window has expired.',
          code: 'QR_SESSION_EXPIRED',
        });
        return;
      }

      if (!diagnosis || !Array.isArray(medications) || medications.length === 0) {
        res.status(400).json({
          error: 'Diagnosis and at least one medication entry are required.',
        });
        return;
      }

      const doctor = await prisma.doctorProfile.findUnique({
        where: { id: doctorId },
        include: { patientUser: true },
      });

      const targetWorkspaceId =
        workspaceId || qrSession.workspaceId || undefined;
      let workspaceNameSnapshot: string | null = 'Independent Chamber';

      if (targetWorkspaceId) {
        const ws = await prisma.workspace.findUnique({
          where: { id: String(targetWorkspaceId) },
        });
        if (ws) {
          workspaceNameSnapshot = ws.name;
        }
      }

      const documentCode = `RX-2026-${Math.floor(100000 + Math.random() * 900000)}`;

      const prescription = await prisma.vaultDocument.create({
        data: {
          documentCode,
          patientId: qrSession.patientId,
          type: 'PRESCRIPTION',
          title: title || `Prescription — ${diagnosis}`,
          summary: `${diagnosis} (${medications.length} medication(s))`,
          doctorId,
          doctorNameSnapshot: doctor?.patientUser.name || req.user!.name,
          workspaceId: targetWorkspaceId ? String(targetWorkspaceId) : null,
          workspaceNameSnapshot,
          qrSessionId: qrSession.id,
          isImmutable: true, // Strictly immutable after sending!
          structuredData: {
            diagnosis,
            chiefComplaints: chiefComplaints || '',
            vitals: vitals || { bp: '120/80 mmHg', pulse: '74 bpm', temp: '98.6 F', weight: '68 kg' },
            medications,
            recommendedTests: Array.isArray(recommendedTests)
              ? recommendedTests
              : [],
            advice: advice || 'Take medications as prescribed and stay hydrated.',
            followUpDate: followUpDate || null,
            issuedAt: new Date().toISOString(),
            doctorLicense: doctor?.doctorLicense,
            doctorSpecialty: doctor?.specialty,
            doctorDegrees: doctor?.degrees || [],
          },
        },
        include: {
          patient: {
            select: { id: true, uniqueId: true, name: true, email: true },
          },
          workspace: {
            select: { id: true, name: true, workspaceCode: true },
          },
        },
      });

      await prisma.patientActivityLog.create({
        data: {
          patientId: qrSession.patientId,
          action: 'PRESCRIPTION_RECEIVED',
          description: `Received immutable prescription (${documentCode}) from ${doctor?.patientUser.name} (${workspaceNameSnapshot})`,
        },
      });

      // Notify Patient at top navbar notification section
      await prisma.notification.create({
        data: {
          recipientPatientId: qrSession.patientId,
          type: 'PRESCRIPTION_RECEIVED',
          title: `New Prescription from ${doctor?.patientUser.name}`,
          message: `${doctor?.patientUser.name} (${doctor?.specialty}) sent prescription ${documentCode} (${diagnosis}) to your Report & Prescription Vault.`,
          metadata: {
            documentId: prescription.id,
            documentCode,
            workspaceName: workspaceNameSnapshot,
          },
        },
      });

      res.status(201).json({
        message:
          'Prescription sent to Patient Vault and permanently locked (immutable).',
        prescription,
      });
    } catch (err: any) {
      res.status(500).json({
        error: 'Failed to issue prescription',
        details: err?.message,
      });
    }
  }
);

// 6. Enforce Prescription Immutability (Doctor can view lifetime, but CANNOT change after sending)
const rejectPrescriptionModification = (req: Request, res: Response): void => {
  res.status(403).json({
    error:
      'Forbidden: Prescriptions are permanently immutable after being sent to the Patient Vault and cannot be edited or deleted.',
    code: 'PRESCRIPTION_IMMUTABLE',
    prescriptionId: req.params.id,
  });
};

doctorRouter.put('/prescriptions/:id', rejectPrescriptionModification);
doctorRouter.patch('/prescriptions/:id', rejectPrescriptionModification);
doctorRouter.delete('/prescriptions/:id', rejectPrescriptionModification);

// 7. Doctor Lifetime Patient & Prescription History (With Sorting by Workspace or Date/Time)
doctorRouter.get(
  '/history',
  requireApprovedDoctor,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const doctorId = req.user!.doctorId!;
      const { workspaceId, search, sortBy = 'date_desc' } = req.query;

      const where: any = {
        doctorId,
        type: 'PRESCRIPTION',
      };

      if (workspaceId && String(workspaceId) !== 'ALL') {
        if (String(workspaceId) === 'INDEPENDENT') {
          where.workspaceId = null;
        } else {
          where.workspaceId = String(workspaceId);
        }
      }

      if (search && String(search).trim()) {
        const q = String(search).trim();
        where.OR = [
          { title: { contains: q, mode: 'insensitive' } },
          { documentCode: { contains: q, mode: 'insensitive' } },
          { patient: { name: { contains: q, mode: 'insensitive' } } },
          { patient: { uniqueId: { contains: q, mode: 'insensitive' } } },
          { workspaceNameSnapshot: { contains: q, mode: 'insensitive' } },
        ];
      }

      let orderBy: any = { createdAt: 'desc' };
      if (sortBy === 'date_asc') orderBy = { createdAt: 'asc' };
      if (sortBy === 'workspace') orderBy = { workspaceNameSnapshot: 'asc' };

      const prescriptions = await prisma.vaultDocument.findMany({
        where,
        orderBy,
        include: {
          patient: {
            select: {
              id: true,
              uniqueId: true,
              name: true,
              email: true,
              phone: true,
              bloodGroup: true,
              gender: true,
              dateOfBirth: true,
              accountType: true,
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

      // Group patients summary for the Doctor's patient list view
      const patientHistoryMap = new Map<string, any>();
      for (const rx of prescriptions) {
        if (rx.patient) {
          const existing = patientHistoryMap.get(rx.patient.id) || {
            patient: rx.patient,
            totalPrescriptions: 0,
            lastVisitedAt: rx.createdAt,
            workspacesVisited: new Set<string>(),
            prescriptions: [],
          };
          existing.totalPrescriptions += 1;
          existing.workspacesVisited.add(
            rx.workspace?.name || rx.workspaceNameSnapshot || 'Independent Chamber'
          );
          existing.prescriptions.push(rx);
          patientHistoryMap.set(rx.patient.id, existing);
        }
      }

      const patientsList = Array.from(patientHistoryMap.values()).map((p) => ({
        ...p,
        workspacesVisited: Array.from(p.workspacesVisited),
      }));

      res.json({
        prescriptions,
        patientsList,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to load Doctor history' });
    }
  }
);

// 8. Doctor — Hospital / Workspace Affiliations (View Active, Pending, and Available Workspaces)
doctorRouter.get(
  '/affiliations',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const doctor = await prisma.doctorProfile.findUnique({
        where: { patientUserId: req.user!.patientId! },
      });

      if (!doctor) {
        res.status(404).json({ error: 'Doctor profile not found' });
        return;
      }

      const [affiliations, availableWorkspaces] = await Promise.all([
        prisma.doctorWorkspaceAffiliation.findMany({
          where: { doctorId: doctor.id },
          orderBy: { createdAt: 'desc' },
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
                email: true,
                departments: true,
                approvalStatus: true,
              },
            },
          },
        }),
        prisma.workspace.findMany({
          where: { approvalStatus: 'APPROVED' },
          select: {
            id: true,
            workspaceCode: true,
            name: true,
            type: true,
            area: true,
            address: true,
            phone: true,
            departments: true,
          },
          orderBy: { name: 'asc' },
        }),
      ]);

      const indepConfig = getIndependentChamberConfig(doctor.profileVisibility);
      const enrichedAffiliations = affiliations.map((aff) => {
        const parsed = parseScheduleAndSlots(aff.schedule);
        return {
          ...aff,
          scheduleLabel: parsed.scheduleLabel,
          availableSlots: parsed.availableSlots,
        };
      });

      res.json({
        affiliations: enrichedAffiliations,
        availableWorkspaces,
        independentChamber: indepConfig,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to load Doctor affiliations' });
    }
  }
);

// 9. Doctor Sends Affiliation Invitation to a Specific Hospital / Workspace (Bidirectional Flow)
doctorRouter.post(
  '/affiliations/request',
  requireApprovedDoctor,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const doctorId = req.user!.doctorId!;
      const {
        workspaceId,
        consultationFee = 1000,
        schedule = 'Sun, Tue, Thu: 5:00 PM - 9:00 PM',
        availableSlots,
        roomNumber,
        department,
      } = req.body;

      if (!workspaceId) {
        res.status(400).json({ error: 'workspaceId is required' });
        return;
      }

      const workspace = await prisma.workspace.findUnique({
        where: { id: String(workspaceId) },
      });

      if (!workspace || workspace.approvalStatus !== 'APPROVED') {
        res.status(404).json({ error: 'Approved Workspace not found' });
        return;
      }

      const formattedSchedule = formatScheduleWithSlots(
        String(schedule),
        Array.isArray(availableSlots) ? availableSlots : undefined
      );

      const affiliation = await prisma.doctorWorkspaceAffiliation.upsert({
        where: {
          doctorId_workspaceId: {
            doctorId,
            workspaceId: workspace.id,
          },
        },
        update: {
          initiatedBy: 'DOCTOR',
          statusUpdatedBy: 'DOCTOR',
          status: 'PENDING',
          consultationFee: Number(consultationFee) || 1000,
          schedule: formattedSchedule,
          ...(roomNumber !== undefined ? { roomNumber: roomNumber || null } : {}),
          department: department || null,
        },
        create: {
          doctorId,
          workspaceId: workspace.id,
          initiatedBy: 'DOCTOR',
          statusUpdatedBy: 'DOCTOR',
          status: 'PENDING',
          consultationFee: Number(consultationFee) || 1000,
          schedule: formattedSchedule,
          roomNumber: roomNumber || null,
          department: department || null,
        },
        include: {
          workspace: {
            select: { id: true, name: true, workspaceCode: true, area: true },
          },
        },
      });

      const auditLog = await prisma.workspaceAuditLog.create({
        data: {
          workspaceId: workspace.id,
          actorPatientId: req.user!.patientId!,
          actorNameSnapshot: req.user!.name,
          actorRolesSnapshot: ['Doctor'],
          action: 'DOCTOR_AFFILIATION_REQUESTED',
          category: 'DOCTORS',
          targetType: 'AFFILIATION',
          targetId: affiliation.id,
          description: `Dr. ${req.user?.name} requested chamber affiliation with ${workspace.name} (Proposed Fee: ${affiliation.consultationFee} BDT, Schedule: ${affiliation.schedule}).`,
        },
      });

      if (process.env.NODE_ENV !== 'test') {
        console.info(
          `[WORKSPACE_AUDIT_LOG] [${auditLog.action}] Workspace=${workspace.workspaceCode} Actor="Dr. ${req.user?.name}" -> ${auditLog.description}`
        );
      }

      await prisma.notification.create({
        data: {
          recipientWorkspaceId: workspace.id,
          requiredPermission: 'doctors.invite',
          type: 'DOCTOR_AFFILIATION',
          title: 'New Doctor Affiliation Request',
          message: `Dr. ${req.user?.name} requested affiliation with ${workspace.name} (Proposed Fee: ${affiliation.consultationFee} BDT).`,
          metadata: { affiliationId: affiliation.id },
        },
      });

      res.status(201).json({
        message: `Affiliation invitation sent to ${workspace.name}.`,
        affiliation,
        auditLog,
      });
    } catch (err: any) {
      res.status(500).json({
        error: 'Failed to request workspace affiliation',
        details: err?.message,
      });
    }
  }
);

// 10. Doctor Accepts, Rejects, Revokes, Undoes Revoke, or Re-Requests a Workspace Affiliation
doctorRouter.patch(
  '/affiliations/:id/respond',
  requireApprovedDoctor,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const doctorId = req.user!.doctorId!;
      const { status, consultationFee, schedule, availableSlots, roomNumber } =
        req.body; // 'ACTIVE', 'REJECTED', 'REVOKED', 'PENDING' or schedule-only update

      if (
        status !== undefined &&
        !['ACTIVE', 'REJECTED', 'REVOKED', 'PENDING'].includes(status)
      ) {
        res.status(400).json({
          error: 'status must be ACTIVE, REJECTED, REVOKED, or PENDING',
        });
        return;
      }

      const aff = await prisma.doctorWorkspaceAffiliation.findFirst({
        where: {
          id: String(req.params.id),
          doctorId,
        },
        include: { workspace: true },
      });

      if (!aff) {
        res.status(404).json({ error: 'Affiliation record not found' });
        return;
      }

      // Security check: Doctor can set ACTIVE only if accepting an incoming workspace invite
      // OR undoing their own previous revocation, OR keeping an already ACTIVE affiliation active while updating schedule/slots!
      if (status === 'ACTIVE' && aff.status !== 'ACTIVE') {
        const canAcceptInvite =
          aff.status === 'PENDING' && aff.initiatedBy === 'WORKSPACE';
        const canUndoOwnRevoke =
          aff.status === 'REVOKED' && aff.statusUpdatedBy === 'DOCTOR';

        if (!canAcceptInvite && !canUndoOwnRevoke) {
          res.status(403).json({
            error:
              'Cannot activate affiliation without Hospital approval. Use Re-request Affiliation (PENDING) instead.',
          });
          return;
        }
      }

      const isUndoRestore =
        status === 'ACTIVE' &&
        aff.status === 'REVOKED' &&
        aff.statusUpdatedBy === 'DOCTOR';

      const nextSchedule =
        schedule !== undefined || Array.isArray(availableSlots)
          ? formatScheduleWithSlots(
              schedule !== undefined ? String(schedule) : aff.schedule,
              Array.isArray(availableSlots) ? availableSlots : undefined
            )
          : undefined;

      const updated = await prisma.doctorWorkspaceAffiliation.update({
        where: { id: aff.id },
        data: {
          ...(status !== undefined && status !== aff.status
            ? {
                status,
                statusUpdatedBy: 'DOCTOR',
                ...(status === 'PENDING' ? { initiatedBy: 'DOCTOR' } : {}),
              }
            : {}),
          ...(consultationFee !== undefined
            ? { consultationFee: Number(consultationFee) }
            : {}),
          ...(nextSchedule !== undefined ? { schedule: nextSchedule } : {}),
          ...(roomNumber !== undefined ? { roomNumber: roomNumber || null } : {}),
        },
        include: {
          workspace: {
            select: { id: true, name: true, workspaceCode: true, area: true },
          },
        },
      });

      const actionCode = isUndoRestore
        ? 'DOCTOR_AFFILIATION_RESTORED'
        : status === 'ACTIVE'
          ? 'DOCTOR_AFFILIATION_ACCEPTED'
          : status === 'PENDING'
            ? 'DOCTOR_AFFILIATION_RE_REQUESTED'
            : `DOCTOR_AFFILIATION_${status}`;

      const auditLog = await prisma.workspaceAuditLog.create({
        data: {
          workspaceId: aff.workspaceId,
          actorPatientId: req.user!.patientId!,
          actorNameSnapshot: req.user!.name,
          actorRolesSnapshot: ['Doctor'],
          action: actionCode,
          category: 'DOCTORS',
          targetType: 'AFFILIATION',
          targetId: updated.id,
          description: isUndoRestore
            ? `Dr. ${req.user?.name} undid revocation and restored ACTIVE affiliation at ${aff.workspace.name}.`
            : status === 'ACTIVE'
              ? `Dr. ${req.user?.name} accepted affiliation invitation at ${aff.workspace.name} (Fee: ${updated.consultationFee} BDT, Schedule: ${updated.schedule}).`
              : status === 'PENDING'
                ? `Dr. ${req.user?.name} re-requested chamber affiliation with ${aff.workspace.name}.`
                : `Dr. ${req.user?.name} updated affiliation status at ${aff.workspace.name} to ${status}.`,
        },
      });

      if (process.env.NODE_ENV !== 'test') {
        console.info(
          `[WORKSPACE_AUDIT_LOG] [${auditLog.action}] Workspace=${aff.workspace.workspaceCode} Actor="Dr. ${req.user?.name}" -> ${auditLog.description}`
        );
      }

      await prisma.notification.create({
        data: {
          recipientWorkspaceId: aff.workspaceId,
          requiredPermission: status === 'PENDING' ? 'doctors.invite' : 'doctors.view',
          type: 'DOCTOR_AFFILIATION',
          title: isUndoRestore
            ? 'Doctor Affiliation Restored'
            : status === 'ACTIVE'
              ? 'Doctor Accepted Affiliation Invitation'
              : status === 'PENDING'
                ? 'Doctor Re-Requested Affiliation'
                : `Doctor Affiliation ${status}`,
          message: auditLog.description,
          metadata: { affiliationId: updated.id },
        },
      });

      res.json({
        message: isUndoRestore
          ? `Revocation undone — affiliation with ${aff.workspace.name} is ACTIVE again.`
          : status === 'PENDING'
            ? `Re-affiliation request sent to ${aff.workspace.name}.`
            : `Affiliation with ${aff.workspace.name} updated to ${status}.`,
        affiliation: updated,
        auditLog,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to update affiliation status' });
    }
  }
);

// 11. Doctor Profile & Public Visibility Customization
doctorRouter.patch(
  '/profile',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const doctor = await prisma.doctorProfile.findUnique({
        where: { patientUserId: req.user!.patientId! },
      });

      if (!doctor) {
        res.status(404).json({ error: 'Doctor profile not found' });
        return;
      }

      const {
        specialty,
        degrees,
        achievements,
        bio,
        area,
        experienceYears,
        defaultConsultationFee,
        profileImage,
        profileVisibility,
        independentSchedule,
        independentSlots,
      } = req.body;

      const updateData: any = {};
      if (specialty !== undefined) updateData.specialty = String(specialty).trim();
      if (degrees !== undefined) {
        updateData.degrees = Array.isArray(degrees)
          ? degrees
          : String(degrees)
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
      }
      if (achievements !== undefined) {
        updateData.achievements = Array.isArray(achievements)
          ? achievements
          : String(achievements)
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
      }
      if (bio !== undefined) updateData.bio = bio;
      if (area !== undefined) updateData.area = String(area).trim();
      if (experienceYears !== undefined)
        updateData.experienceYears = Number(experienceYears);
      if (defaultConsultationFee !== undefined)
        updateData.defaultConsultationFee = Number(defaultConsultationFee);
      if (profileImage !== undefined) updateData.profileImage = profileImage;
      if (
        (profileVisibility !== undefined && typeof profileVisibility === 'object') ||
        independentSchedule !== undefined ||
        independentSlots !== undefined
      ) {
        const currentVis = (doctor.profileVisibility as Record<string, any>) || {};
        const mergedVis: Record<string, any> = {
          ...currentVis,
          ...(profileVisibility && typeof profileVisibility === 'object'
            ? profileVisibility
            : {}),
        };
        if (independentSchedule !== undefined) {
          mergedVis.independentSchedule = String(independentSchedule).trim();
        }
        if (Array.isArray(independentSlots)) {
          mergedVis.independentSlots = Array.from(
            new Set(
              independentSlots.map((s: any) => String(s).trim()).filter(Boolean)
            )
          );
        }
        updateData.profileVisibility = mergedVis;
      }

      const updated = await prisma.doctorProfile.update({
        where: { id: doctor.id },
        data: updateData,
        include: {
          patientUser: {
            select: {
              id: true,
              uniqueId: true,
              name: true,
              email: true,
              phone: true,
            },
          },
        },
      });

      res.json({
        message:
          'Doctor profile and public visibility preferences updated successfully.',
        doctor: updated,
      });
    } catch (err: any) {
      res.status(500).json({
        error: 'Failed to update Doctor profile',
        details: err?.message,
      });
    }
  }
);
