import { Router, Request, Response } from 'express';
import { prisma } from '../../config/prisma';
import {
  authenticateToken,
  requireCentralRegistry,
} from '../../middleware/security';
import { ALL_PERMISSION_KEYS } from '../../config/permissions';

export const centralRegistryRouter = Router();

centralRegistryRouter.use(authenticateToken, requireCentralRegistry);

// 1. DGHS Overview Dashboard
centralRegistryRouter.get(
  '/overview',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const now = new Date();
      const [
        totalPatients,
        activePatients,
        disabledPatients,
        childPatients,
        oldPatients,
        doctorsByStatus,
        workspacesByStatus,
        workspacesByType,
        totalVaultDocs,
        totalPrescriptions,
        totalLabReports,
        totalBillingDocs,
        totalPackages,
        totalAppointments,
        appointmentsByStatus,
        activeFamilyLinksCount,
        activeQrSessionsCount,
        recentPatients,
        pendingDoctors,
        pendingWorkspaces,
        recentActivityLogs,
        allAffiliations,
        allFamilyLinks,
        allWorkspacesSummary,
        recentConsultDocs,
        recentAppointments,
      ] = await Promise.all([
        prisma.patientUser.count(),
        prisma.patientUser.count({ where: { status: 'ACTIVE' } }),
        prisma.patientUser.count({ where: { status: 'DISABLED' } }),
        prisma.patientUser.count({ where: { accountType: 'CHILD' } }),
        prisma.patientUser.count({ where: { accountType: 'OLD' } }),
        prisma.doctorProfile.groupBy({
          by: ['approvalStatus'],
          _count: { _all: true },
        }),
        prisma.workspace.groupBy({
          by: ['approvalStatus'],
          _count: { _all: true },
        }),
        prisma.workspace.groupBy({
          by: ['type'],
          _count: { _all: true },
        }),
        prisma.vaultDocument.count(),
        prisma.vaultDocument.count({ where: { type: 'PRESCRIPTION' } }),
        prisma.vaultDocument.count({ where: { type: 'LAB_REPORT' } }),
        prisma.vaultDocument.count({ where: { type: 'BILLING_DOC' } }),
        prisma.healthPackage.count({ where: { isActive: true } }),
        prisma.appointment.count(),
        prisma.appointment.groupBy({
          by: ['status'],
          _count: { _all: true },
        }),
        prisma.familyRelationship.count({ where: { status: 'ACTIVE' } }),
        prisma.qrShareSession.count({
          where: {
            status: { in: ['GENERATED', 'SCANNED_ACTIVE'] },
            expiresAt: { gt: now },
          },
        }),
        prisma.patientUser.findMany({
          take: 6,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            uniqueId: true,
            name: true,
            email: true,
            phone: true,
            accountType: true,
            status: true,
            createdAt: true,
          },
        }),
        prisma.doctorProfile.findMany({
          where: { approvalStatus: 'PENDING' },
          include: {
            patientUser: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                uniqueId: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.workspace.findMany({
          where: { approvalStatus: 'PENDING' },
          include: {
            owner: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                uniqueId: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.patientActivityLog.findMany({
          take: 12,
          orderBy: { createdAt: 'desc' },
          include: {
            patient: {
              select: { id: true, name: true, uniqueId: true },
            },
          },
        }),
        prisma.doctorWorkspaceAffiliation.findMany({
          orderBy: { updatedAt: 'desc' },
          include: {
            doctor: {
              include: {
                patientUser: { select: { id: true, name: true, uniqueId: true } },
              },
            },
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
        }),
        prisma.familyRelationship.findMany({
          orderBy: { createdAt: 'desc' },
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
        }),
        prisma.workspace.findMany({
          orderBy: { createdAt: 'desc' },
          include: {
            _count: {
              select: {
                members: true,
                doctorAffiliations: true,
                appointments: true,
                vaultDocuments: true,
                packages: true,
              },
            },
            packages: {
              orderBy: { price: 'asc' },
            },
            appointments: { select: { patientId: true } },
            vaultDocuments: { select: { patientId: true } },
          },
        }),
        prisma.vaultDocument.findMany({
          where: { doctorId: { not: null } },
          orderBy: { createdAt: 'desc' },
          include: {
            patient: { select: { id: true, uniqueId: true, name: true } },
            doctor: {
              include: { patientUser: { select: { name: true } } },
            },
            workspace: { select: { id: true, name: true } },
          },
        }),
        prisma.appointment.findMany({
          orderBy: { createdAt: 'desc' },
          include: {
            patient: { select: { id: true, uniqueId: true, name: true } },
            doctor: {
              include: { patientUser: { select: { name: true } } },
            },
            workspace: { select: { id: true, name: true } },
          },
        }),
      ]);

      const formatStatusCounts = (
        rows: { approvalStatus: string; _count: { _all: number } }[]
      ) => {
        const map: Record<string, number> = {
          APPROVED: 0,
          PENDING: 0,
          DECLINED: 0,
          DISABLED: 0,
        };
        for (const r of rows) {
          map[r.approvalStatus] = r._count._all;
        }
        return map;
      };

      const facilityTypesMap: Record<string, number> = {
        HOSPITAL: 0,
        CLINIC: 0,
        DIAGNOSTIC_CENTER: 0,
        CHAMBER: 0,
      };
      for (const t of workspacesByType as any[]) {
        facilityTypesMap[t.type] = t._count._all;
      }

      const apptStatusMap: Record<string, number> = {
        PENDING: 0,
        APPROVED: 0,
        COMPLETED: 0,
        CANCELLED: 0,
      };
      for (const a of appointmentsByStatus as any[]) {
        apptStatusMap[a.status] = a._count._all;
      }

      // Build Patient <-> Doctor Consultation Matrix across the centralized platform
      const pdMap = new Map<string, any>();
      for (const doc of recentConsultDocs) {
        if (doc.patient && doc.doctor) {
          const key = `${doc.patient.id}::${doc.doctor.id}`;
          const row = pdMap.get(key) || {
            key,
            patientId: doc.patient.id,
            patientCode: doc.patient.uniqueId,
            patientName: doc.patient.name,
            doctorId: doc.doctor.id,
            doctorCode: doc.doctor.doctorIdCode,
            doctorName: doc.doctor.patientUser?.name || 'Doctor',
            specialty: doc.doctor.specialty,
            facilities: new Set<string>(),
            facilityMap: new Map<string, { id: string; name: string }>(),
            prescriptionsCount: 0,
            appointmentsCount: 0,
            lastActivityAt: doc.createdAt,
          };
          row.prescriptionsCount += 1;
          if (doc.workspace?.name) {
            row.facilities.add(doc.workspace.name);
            row.facilityMap.set(doc.workspace.id, {
              id: doc.workspace.id,
              name: doc.workspace.name,
            });
          }
          pdMap.set(key, row);
        }
      }

      for (const apt of recentAppointments) {
        if (apt.patient && apt.doctor) {
          const key = `${apt.patient.id}::${apt.doctor.id}`;
          const row = pdMap.get(key) || {
            key,
            patientId: apt.patient.id,
            patientCode: apt.patient.uniqueId,
            patientName: apt.patient.name,
            doctorId: apt.doctor.id,
            doctorCode: apt.doctor.doctorIdCode,
            doctorName: apt.doctor.patientUser?.name || 'Doctor',
            specialty: apt.doctor.specialty,
            facilities: new Set<string>(),
            facilityMap: new Map<string, { id: string; name: string }>(),
            prescriptionsCount: 0,
            appointmentsCount: 0,
            lastActivityAt: apt.createdAt,
          };
          row.appointmentsCount += 1;
          if (apt.workspace?.name) {
            row.facilities.add(apt.workspace.name);
            row.facilityMap.set(apt.workspace.id, {
              id: apt.workspace.id,
              name: apt.workspace.name,
            });
          }
          pdMap.set(key, row);
        }
      }

      const patientDoctorMatrix = Array.from(pdMap.values()).map(
        ({ facilityMap, facilities, ...rest }) => ({
          ...rest,
          facilities: Array.from(facilities),
          facilityLinks: Array.from(facilityMap.values()),
        })
      );

      const hospitalDoctorMatrix = allAffiliations.map((aff) => ({
        affiliationId: aff.id,
        status: aff.status,
        consultationFee: aff.consultationFee,
        schedule: aff.schedule,
        doctorId: aff.doctor.id,
        doctorCode: aff.doctor.doctorIdCode,
        doctorName: aff.doctor.patientUser?.name,
        specialty: aff.doctor.specialty,
        workspaceId: aff.workspace.id,
        workspaceCode: aff.workspace.workspaceCode,
        workspaceName: aff.workspace.name,
        workspaceType: aff.workspace.type,
        area: aff.workspace.area,
      }));

      const publishedPackages = allWorkspacesSummary.flatMap((ws) =>
        (ws.packages || []).map((pkg) => ({
          ...pkg,
          workspace: {
            id: ws.id,
            workspaceCode: ws.workspaceCode,
            name: ws.name,
            type: ws.type,
            area: ws.area,
            approvalStatus: ws.approvalStatus,
          },
        }))
      );

      const hospitalEcosystemSummary = allWorkspacesSummary.map((ws) => {
        const uniquePatientIds = new Set<string>();
        ws.appointments.forEach((a) => uniquePatientIds.add(a.patientId));
        ws.vaultDocuments.forEach((d) => uniquePatientIds.add(d.patientId));
        return {
          workspaceId: ws.id,
          workspaceCode: ws.workspaceCode,
          name: ws.name,
          type: ws.type,
          area: ws.area,
          approvalStatus: ws.approvalStatus,
          affiliatedDoctorsCount: ws._count.doctorAffiliations,
          connectedPatientsCount: uniquePatientIds.size,
          staffCount: ws._count.members,
          packagesCount: ws._count.packages,
          packages: ws.packages || [],
          recordsCount: ws._count.vaultDocuments,
          appointmentsCount: ws._count.appointments,
        };
      });

      res.json({
        metrics: {
          patients: {
            total: totalPatients,
            active: activePatients,
            disabled: disabledPatients,
            normalAccounts: totalPatients - childPatients - oldPatients,
            childAccounts: childPatients,
            seniorAccounts: oldPatients,
          },
          doctors: formatStatusCounts(doctorsByStatus as any),
          workspaces: {
            ...formatStatusCounts(workspacesByStatus as any),
            byType: facilityTypesMap,
          },
          clinical: {
            totalVaultDocs,
            totalPrescriptions,
            totalLabReports,
            totalBillingDocs,
            totalPackages,
            totalAppointments,
            appointmentsByStatus: apptStatusMap,
          },
          connections: {
            activeDoctorHospitalAffiliations: allAffiliations.filter(
              (a) => a.status === 'ACTIVE'
            ).length,
            totalDoctorHospitalAffiliations: allAffiliations.length,
            activeFamilyLinksCount,
            activeQrSessionsCount,
            doctorPatientPairsCount: patientDoctorMatrix.length,
          },
        },
        pendingApprovals: {
          doctors: pendingDoctors,
          workspaces: pendingWorkspaces,
        },
        ecosystemConnections: {
          hospitalDoctorMatrix,
          patientDoctorMatrix,
          hospitalEcosystemSummary,
          publishedPackages,
          familyLinks: allFamilyLinks,
        },
        recentPatients,
        recentActivityLogs,
      });
    } catch (err: any) {
      res.status(500).json({
        error: 'Failed to load Central Registry overview',
        details: err?.message,
      });
    }
  }
);

// 2. Central Registry — Patient Section: List all patients with family & doctor summary
centralRegistryRouter.get(
  '/patients',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { search, status, accountType } = req.query;

      const where: any = {};
      if (status && ['ACTIVE', 'DISABLED'].includes(String(status))) {
        where.status = String(status);
      }
      if (accountType && ['NORMAL', 'CHILD', 'OLD'].includes(String(accountType))) {
        where.accountType = String(accountType);
      }
      if (search && String(search).trim()) {
        const q = String(search).trim();
        where.OR = [
          { name: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q, mode: 'insensitive' } },
          { uniqueId: { contains: q, mode: 'insensitive' } },
          { nationalId: { contains: q, mode: 'insensitive' } },
        ];
      }

      const patients = await prisma.patientUser.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          uniqueId: true,
          name: true,
          email: true,
          phone: true,
          secondaryEmails: true,
          secondaryPhones: true,
          nationalId: true,
          accountType: true,
          status: true,
          bloodGroup: true,
          gender: true,
          dateOfBirth: true,
          address: true,
          createdAt: true,
          doctorProfile: {
            select: {
              id: true,
              doctorIdCode: true,
              specialty: true,
              approvalStatus: true,
            },
          },
          maintainedDependents: {
            include: {
              dependent: {
                select: {
                  id: true,
                  uniqueId: true,
                  name: true,
                  accountType: true,
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
          _count: {
            select: {
              vaultDocuments: true,
              appointments: true,
              qrSessions: true,
            },
          },
          vaultDocuments: {
            select: { doctorId: true, workspaceId: true },
          },
          appointments: {
            select: { doctorId: true, workspaceId: true },
          },
          qrSessions: {
            select: { scannedByDoctorId: true, workspaceId: true },
          },
        },
      });

      const enrichedPatients = patients.map((p) => {
        const docIds = new Set<string>();
        const wsIds = new Set<string>();
        p.vaultDocuments.forEach((d) => {
          if (d.doctorId) docIds.add(d.doctorId);
          if (d.workspaceId) wsIds.add(d.workspaceId);
        });
        p.appointments.forEach((a) => {
          if (a.doctorId) docIds.add(a.doctorId);
          if (a.workspaceId) wsIds.add(a.workspaceId);
        });
        p.qrSessions.forEach((q) => {
          if (q.scannedByDoctorId) docIds.add(q.scannedByDoctorId);
          if (q.workspaceId) wsIds.add(q.workspaceId);
        });

        const { vaultDocuments, appointments, qrSessions, ...rest } = p;
        return {
          ...rest,
          connectedDoctorsCount: docIds.size,
          connectedWorkspacesCount: wsIds.size,
        };
      });

      res.json({ patients: enrichedPatients });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to list patients' });
    }
  }
);

// 3. Central Registry — Patient Deep Inspection (Vault, Activities, Family Child/Old links, Doctor Consultation Connections)
centralRegistryRouter.get(
  '/patients/:id/inspect',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const patient = await prisma.patientUser.findUnique({
        where: { id: String(req.params.id) },
        include: {
          vaultDocuments: {
            orderBy: { createdAt: 'desc' },
            include: {
              doctor: {
                include: {
                  patientUser: { select: { name: true, email: true, phone: true } },
                },
              },
              workspace: {
                select: { id: true, name: true, workspaceCode: true, type: true },
              },
            },
          },
          activityLogs: {
            orderBy: { createdAt: 'desc' },
            take: 50,
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
                  dateOfBirth: true,
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
                  accountType: true,
                },
              },
            },
          },
          appointments: {
            orderBy: { createdAt: 'desc' },
            include: {
              doctor: {
                include: {
                  patientUser: { select: { name: true, phone: true } },
                },
              },
              workspace: {
                select: { id: true, name: true, workspaceCode: true, area: true },
              },
            },
          },
          qrSessions: {
            orderBy: { createdAt: 'desc' },
            include: {
              scannedByDoctor: {
                include: {
                  patientUser: { select: { name: true } },
                },
              },
              workspace: {
                select: { id: true, name: true },
              },
            },
          },
        },
      });

      if (!patient) {
        res.status(404).json({ error: 'Patient not found' });
        return;
      }

      // Compute unique Doctor connections (from Prescriptions, Appointments, and Scanned QR sessions)
      const doctorConnectionsMap = new Map<string, any>();

      for (const doc of patient.vaultDocuments) {
        if (doc.doctor) {
          const existing = doctorConnectionsMap.get(doc.doctor.id) || {
            doctorId: doc.doctor.id,
            doctorCode: doc.doctor.doctorIdCode,
            doctorName:
              doc.doctor.patientUser?.name || doc.doctorNameSnapshot || 'Doctor',
            specialty: doc.doctor.specialty,
            prescriptionsCount: 0,
            appointmentsCount: 0,
            qrScansCount: 0,
            lastInteractionAt: doc.createdAt,
          };
          existing.prescriptionsCount += 1;
          doctorConnectionsMap.set(doc.doctor.id, existing);
        }
      }

      for (const apt of patient.appointments) {
        if (apt.doctor) {
          const existing = doctorConnectionsMap.get(apt.doctor.id) || {
            doctorId: apt.doctor.id,
            doctorCode: apt.doctor.doctorIdCode,
            doctorName: apt.doctor.patientUser?.name || 'Doctor',
            specialty: apt.doctor.specialty,
            prescriptionsCount: 0,
            appointmentsCount: 0,
            qrScansCount: 0,
            lastInteractionAt: apt.createdAt,
          };
          existing.appointmentsCount += 1;
          doctorConnectionsMap.set(apt.doctor.id, existing);
        }
      }

      for (const qr of patient.qrSessions) {
        if (qr.scannedByDoctor) {
          const existing = doctorConnectionsMap.get(qr.scannedByDoctor.id) || {
            doctorId: qr.scannedByDoctor.id,
            doctorCode: qr.scannedByDoctor.doctorIdCode,
            doctorName: qr.scannedByDoctor.patientUser?.name || 'Doctor',
            specialty: qr.scannedByDoctor.specialty,
            prescriptionsCount: 0,
            appointmentsCount: 0,
            qrScansCount: 0,
            lastInteractionAt: qr.scannedAt || qr.createdAt,
          };
          existing.qrScansCount += 1;
          doctorConnectionsMap.set(qr.scannedByDoctor.id, existing);
        }
      }

      // Compute unique Hospital / Facility connections for this patient
      const hospitalConnectionsMap = new Map<string, any>();

      for (const doc of patient.vaultDocuments) {
        if (doc.workspace) {
          const item = hospitalConnectionsMap.get(doc.workspace.id) || {
            workspaceId: doc.workspace.id,
            workspaceCode: doc.workspace.workspaceCode,
            workspaceName: doc.workspace.name,
            workspaceType: doc.workspace.type,
            documentsCount: 0,
            appointmentsCount: 0,
            lastVisitedAt: doc.createdAt,
          };
          item.documentsCount += 1;
          hospitalConnectionsMap.set(doc.workspace.id, item);
        }
      }

      for (const apt of patient.appointments) {
        if (apt.workspace) {
          const item = hospitalConnectionsMap.get(apt.workspace.id) || {
            workspaceId: apt.workspace.id,
            workspaceCode: apt.workspace.workspaceCode,
            workspaceName: apt.workspace.name,
            workspaceType: 'HOSPITAL',
            area: apt.workspace.area,
            documentsCount: 0,
            appointmentsCount: 0,
            lastVisitedAt: apt.createdAt,
          };
          item.appointmentsCount += 1;
          if (apt.workspace.area) item.area = apt.workspace.area;
          hospitalConnectionsMap.set(apt.workspace.id, item);
        }
      }

      const { passwordHash, otpCode, ...safePatient } = patient;

      res.json({
        patient: safePatient,
        doctorConnections: Array.from(doctorConnectionsMap.values()),
        hospitalConnections: Array.from(hospitalConnectionsMap.values()),
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to inspect patient details' });
    }
  }
);

// 4. Central Registry — Enable / Disable Patient Account
centralRegistryRouter.patch(
  '/patients/:id/status',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { status, reason } = req.body;
      if (!['ACTIVE', 'DISABLED'].includes(status)) {
        res.status(400).json({ error: 'Status must be ACTIVE or DISABLED' });
        return;
      }

      const updated = await prisma.patientUser.update({
        where: { id: String(req.params.id) },
        data: { status },
      });

      await prisma.patientActivityLog.create({
        data: {
          patientId: updated.id,
          action: `DGHS_STATUS_${status}`,
          description: `Central Registry set patient status to ${status}${reason ? `: ${reason}` : ''}`,
        },
      });

      await prisma.notification.create({
        data: {
          recipientPatientId: updated.id,
          type: 'DGHS_STATUS_CHANGE',
          title: `Account Status Updated by DGHS: ${status}`,
          message:
            reason ||
            `Your patient account (${updated.uniqueId}) is now ${status}.`,
        },
      });

      res.json({
        message: `Patient account ${updated.uniqueId} is now ${status}.`,
        patient: {
          id: updated.id,
          uniqueId: updated.uniqueId,
          name: updated.name,
          status: updated.status,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to update patient status' });
    }
  }
);

// 5. Central Registry — Doctor Section: List all Doctors (Filter by APPROVED, PENDING, DECLINED, DISABLED)
centralRegistryRouter.get(
  '/doctors',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { approvalStatus, search } = req.query;
      const where: any = {};

      if (
        approvalStatus &&
        ['PENDING', 'APPROVED', 'DECLINED', 'DISABLED'].includes(
          String(approvalStatus)
        )
      ) {
        where.approvalStatus = String(approvalStatus);
      }

      if (search && String(search).trim()) {
        const q = String(search).trim();
        where.OR = [
          { doctorIdCode: { contains: q, mode: 'insensitive' } },
          { doctorLicense: { contains: q, mode: 'insensitive' } },
          { nationalId: { contains: q, mode: 'insensitive' } },
          { specialty: { contains: q, mode: 'insensitive' } },
          { area: { contains: q, mode: 'insensitive' } },
          { patientUser: { name: { contains: q, mode: 'insensitive' } } },
          { patientUser: { email: { contains: q, mode: 'insensitive' } } },
        ];
      }

      const doctors = await prisma.doctorProfile.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          patientUser: {
            select: {
              id: true,
              uniqueId: true,
              name: true,
              email: true,
              phone: true,
              status: true,
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
                  approvalStatus: true,
                },
              },
            },
          },
          _count: {
            select: {
              issuedDocuments: true,
              appointments: true,
              scannedQrSessions: true,
            },
          },
        },
      });

      res.json({ doctors });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to list doctors' });
    }
  }
);

// 6. Central Registry — Doctor Deep Inspection (Hospital connections, multiple consultation fees, Patient connectivity)
centralRegistryRouter.get(
  '/doctors/:id/inspect',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const doctor = await prisma.doctorProfile.findUnique({
        where: { id: String(req.params.id) },
        include: {
          patientUser: {
            select: {
              id: true,
              uniqueId: true,
              name: true,
              email: true,
              phone: true,
              nationalId: true,
              status: true,
              createdAt: true,
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
          },
          issuedDocuments: {
            orderBy: { createdAt: 'desc' },
            include: {
              patient: {
                select: {
                  id: true,
                  uniqueId: true,
                  name: true,
                  email: true,
                  phone: true,
                  accountType: true,
                },
              },
              workspace: {
                select: { id: true, name: true, workspaceCode: true },
              },
            },
          },
          appointments: {
            orderBy: { createdAt: 'desc' },
            include: {
              patient: {
                select: {
                  id: true,
                  uniqueId: true,
                  name: true,
                  email: true,
                  phone: true,
                },
              },
              workspace: {
                select: { id: true, name: true, workspaceCode: true },
              },
            },
          },
          scannedQrSessions: {
            orderBy: { scannedAt: 'desc' },
            include: {
              patient: {
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

      if (!doctor) {
        res.status(404).json({ error: 'Doctor not found' });
        return;
      }

      // Aggregate connected patients for this Doctor
      const connectedPatientsMap = new Map<string, any>();

      for (const rx of doctor.issuedDocuments) {
        if (rx.patient) {
          const item = connectedPatientsMap.get(rx.patient.id) || {
            patientId: rx.patient.id,
            uniqueId: rx.patient.uniqueId,
            name: rx.patient.name,
            email: rx.patient.email,
            phone: rx.patient.phone,
            prescriptionsIssued: 0,
            appointmentsCount: 0,
            qrScansCount: 0,
            lastConsultedAt: rx.createdAt,
          };
          item.prescriptionsIssued += 1;
          connectedPatientsMap.set(rx.patient.id, item);
        }
      }

      for (const apt of doctor.appointments) {
        if (apt.patient) {
          const item = connectedPatientsMap.get(apt.patient.id) || {
            patientId: apt.patient.id,
            uniqueId: apt.patient.uniqueId,
            name: apt.patient.name,
            email: apt.patient.email,
            phone: apt.patient.phone,
            prescriptionsIssued: 0,
            appointmentsCount: 0,
            qrScansCount: 0,
            lastConsultedAt: apt.createdAt,
          };
          item.appointmentsCount += 1;
          connectedPatientsMap.set(apt.patient.id, item);
        }
      }

      for (const qr of doctor.scannedQrSessions) {
        if (qr.patient) {
          const item = connectedPatientsMap.get(qr.patient.id) || {
            patientId: qr.patient.id,
            uniqueId: qr.patient.uniqueId,
            name: qr.patient.name,
            email: qr.patient.email,
            phone: qr.patient.phone,
            prescriptionsIssued: 0,
            appointmentsCount: 0,
            qrScansCount: 0,
            lastConsultedAt: qr.scannedAt || qr.createdAt,
          };
          item.qrScansCount += 1;
          connectedPatientsMap.set(qr.patient.id, item);
        }
      }

      // Summarize consultation fees across hospitals/clinics
      const consultationFeesByWorkspace = [
        {
          workspaceId: 'DEFAULT_INDEPENDENT',
          workspaceName: 'Default / Independent Chamber Fee',
          workspaceType: 'CHAMBER',
          consultationFee: doctor.defaultConsultationFee,
          schedule: 'Standard Chamber Hours',
          status: 'ACTIVE',
        },
        ...doctor.workspaceAffiliations.map((aff) => ({
          affiliationId: aff.id,
          workspaceId: aff.workspace.id,
          workspaceCode: aff.workspace.workspaceCode,
          workspaceName: aff.workspace.name,
          workspaceType: aff.workspace.type,
          area: aff.workspace.area,
          consultationFee: aff.consultationFee,
          schedule: aff.schedule,
          roomNumber: aff.roomNumber,
          status: aff.status,
        })),
      ];

      res.json({
        doctor,
        consultationFeesByWorkspace,
        connectedPatients: Array.from(connectedPatientsMap.values()),
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to inspect doctor details' });
    }
  }
);

// 7. Central Registry — Approve, Decline, Disable, or Enable Doctor
centralRegistryRouter.patch(
  '/doctors/:id/status',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { approvalStatus, dghsNotes } = req.body;
      if (
        !['PENDING', 'APPROVED', 'DECLINED', 'DISABLED'].includes(
          approvalStatus
        )
      ) {
        res.status(400).json({
          error:
            'approvalStatus must be PENDING, APPROVED, DECLINED, or DISABLED',
        });
        return;
      }

      const doctor = await prisma.doctorProfile.update({
        where: { id: String(req.params.id) },
        data: {
          approvalStatus,
          dghsNotes: dghsNotes || null,
          approvedAt: approvalStatus === 'APPROVED' ? new Date() : undefined,
        },
        include: {
          patientUser: {
            select: { id: true, name: true, email: true, uniqueId: true },
          },
        },
      });

      await prisma.notification.create({
        data: {
          recipientPatientId: doctor.patientUserId,
          recipientDoctorId: doctor.id,
          type: 'DGHS_STATUS_CHANGE',
          title: `DGHS Doctor Registration Status: ${approvalStatus}`,
          message:
            dghsNotes ||
            `Central Registry (DGHS) updated your Doctor Profile (${doctor.doctorIdCode}) status to ${approvalStatus}.`,
        },
      });

      res.json({
        message: `Doctor ${doctor.patientUser.name} (${doctor.doctorIdCode}) status updated to ${approvalStatus}.`,
        doctor,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to update doctor status' });
    }
  }
);

// 8. Central Registry — Hospital / Workspace Section: List all Workspaces
centralRegistryRouter.get(
  '/workspaces',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { approvalStatus, type, search } = req.query;
      const where: any = {};

      if (
        approvalStatus &&
        ['PENDING', 'APPROVED', 'DECLINED', 'DISABLED'].includes(
          String(approvalStatus)
        )
      ) {
        where.approvalStatus = String(approvalStatus);
      }

      if (
        type &&
        ['HOSPITAL', 'CLINIC', 'DIAGNOSTIC_CENTER', 'CHAMBER'].includes(
          String(type)
        )
      ) {
        where.type = String(type);
      }

      if (search && String(search).trim()) {
        const q = String(search).trim();
        where.OR = [
          { name: { contains: q, mode: 'insensitive' } },
          { workspaceCode: { contains: q, mode: 'insensitive' } },
          { registrationLicense: { contains: q, mode: 'insensitive' } },
          { area: { contains: q, mode: 'insensitive' } },
          { address: { contains: q, mode: 'insensitive' } },
        ];
      }

      const workspaces = await prisma.workspace.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          owner: {
            select: {
              id: true,
              uniqueId: true,
              name: true,
              email: true,
              phone: true,
              nationalId: true,
            },
          },
          packages: {
            orderBy: { price: 'asc' },
          },
          _count: {
            select: {
              members: true,
              doctorAffiliations: true,
              appointments: true,
              vaultDocuments: true,
              packages: true,
            },
          },
        },
      });

      res.json({ workspaces });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to list workspaces' });
    }
  }
);

// 9. Central Registry — Hospital / Workspace Deep Inspection
// Shows: Doctor & Patient connections, all Staff Members + Roles + Combined Permissions, how sections work together (Audit Logs), and Packages offered
centralRegistryRouter.get(
  '/workspaces/:id/inspect',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const workspace = await prisma.workspace.findUnique({
        where: { id: String(req.params.id) },
        include: {
          owner: {
            select: {
              id: true,
              uniqueId: true,
              name: true,
              email: true,
              phone: true,
              nationalId: true,
            },
          },
          roles: {
            orderBy: { createdAt: 'asc' },
          },
          members: {
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
              assignedRoles: {
                include: {
                  role: true,
                },
              },
              _count: {
                select: {
                  auditLogs: true,
                  uploadedDocuments: true,
                  managedAppointments: true,
                },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
          doctorAffiliations: {
            include: {
              doctor: {
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
              },
            },
          },
          packages: {
            orderBy: { createdAt: 'desc' },
          },
          auditLogs: {
            take: 60,
            orderBy: { createdAt: 'desc' },
          },
          appointments: {
            take: 30,
            orderBy: { createdAt: 'desc' },
            include: {
              patient: {
                select: { id: true, uniqueId: true, name: true, phone: true },
              },
              doctor: {
                include: {
                  patientUser: { select: { name: true } },
                },
              },
            },
          },
          vaultDocuments: {
            take: 30,
            orderBy: { createdAt: 'desc' },
            include: {
              patient: {
                select: { id: true, uniqueId: true, name: true, phone: true },
              },
            },
          },
        },
      });

      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      // Compute connected patients for this Hospital/Workspace
      const connectedPatientsMap = new Map<string, any>();

      for (const doc of workspace.vaultDocuments) {
        if (doc.patient) {
          const entry = connectedPatientsMap.get(doc.patient.id) || {
            patientId: doc.patient.id,
            uniqueId: doc.patient.uniqueId,
            name: doc.patient.name,
            phone: doc.patient.phone,
            documentsCount: 0,
            appointmentsCount: 0,
          };
          entry.documentsCount += 1;
          connectedPatientsMap.set(doc.patient.id, entry);
        }
      }

      for (const apt of workspace.appointments) {
        if (apt.patient) {
          const entry = connectedPatientsMap.get(apt.patient.id) || {
            patientId: apt.patient.id,
            uniqueId: apt.patient.uniqueId,
            name: apt.patient.name,
            phone: apt.patient.phone,
            documentsCount: 0,
            appointmentsCount: 0,
          };
          entry.appointmentsCount += 1;
          connectedPatientsMap.set(apt.patient.id, entry);
        }
      }

      const membersWithRoles = workspace.members.map((m) => {
        const permSet = new Set<string>();
        if (m.isOwner || m.isAdmin) {
          ALL_PERMISSION_KEYS.forEach((k) => permSet.add(k));
        }
        m.assignedRoles.forEach((ar) =>
          ar.role.permissions.forEach((p) => permSet.add(p))
        );
        return {
          ...m,
          roleNames: m.assignedRoles.map((ar) => ar.role.name),
          combinedPermissions: Array.from(permSet),
        };
      });

      res.json({
        workspace: {
          ...workspace,
          members: membersWithRoles,
        },
        connectedPatients: Array.from(connectedPatientsMap.values()),
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to inspect workspace details' });
    }
  }
);

// 10. Central Registry — Approve, Decline, Disable, or Enable Hospital / Workspace
centralRegistryRouter.patch(
  '/workspaces/:id/status',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { approvalStatus, dghsNotes } = req.body;
      if (
        !['PENDING', 'APPROVED', 'DECLINED', 'DISABLED'].includes(
          approvalStatus
        )
      ) {
        res.status(400).json({
          error:
            'approvalStatus must be PENDING, APPROVED, DECLINED, or DISABLED',
        });
        return;
      }

      const workspace = await prisma.workspace.update({
        where: { id: String(req.params.id) },
        data: {
          approvalStatus,
          dghsNotes: dghsNotes || null,
          approvedAt: approvalStatus === 'APPROVED' ? new Date() : undefined,
        },
      });

      await prisma.notification.create({
        data: {
          recipientPatientId: workspace.ownerPatientId,
          recipientWorkspaceId: workspace.id,
          type: 'DGHS_STATUS_CHANGE',
          title: `DGHS Workspace Status Updated: ${approvalStatus}`,
          message:
            dghsNotes ||
            `Central Registry (DGHS) updated ${workspace.name} (${workspace.workspaceCode}) status to ${approvalStatus}.`,
        },
      });

      res.json({
        message: `Workspace '${workspace.name}' (${workspace.workspaceCode}) status updated to ${approvalStatus}.`,
        workspace,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to update workspace status' });
    }
  }
);
