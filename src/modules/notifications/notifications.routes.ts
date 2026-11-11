import { Router, Request, Response } from 'express';
import { prisma } from '../../config/prisma';
import { authenticateToken } from '../../middleware/security';
import { ALL_PERMISSION_KEYS } from '../../config/permissions';

export const notificationsRouter = Router();

notificationsRouter.use(authenticateToken);

// 1. Get Notifications Scoped to Active Persona & Workspace Permissions
notificationsRouter.get(
  '/',
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (req.user?.isCentralRegistry) {
        const dghsNotifications = await prisma.notification.findMany({
          where: { recipientCentralRegistry: true },
          orderBy: { createdAt: 'desc' },
          take: 60,
        });
        res.json({
          notifications: dghsNotifications,
          unreadCount: dghsNotifications.filter((n) => !n.isRead).length,
        });
        return;
      }

      const patientId = req.user!.patientId!;
      const { persona = 'PATIENT', workspaceId, actingPatientId } = req.query;

      let targetPatientId = patientId;
      if (actingPatientId && String(actingPatientId) !== patientId) {
        const rel = await prisma.familyRelationship.findUnique({
          where: {
            maintainerId_dependentId: {
              maintainerId: patientId,
              dependentId: String(actingPatientId),
            },
          },
        });
        if (rel && rel.status === 'ACTIVE') {
          targetPatientId = String(actingPatientId);
        }
      }

      // If viewing Workspace Notifications: filter by the member's combined permissions!
      if (persona === 'WORKSPACE' && workspaceId) {
        const member = await prisma.workspaceMember.findUnique({
          where: {
            workspaceId_patientUserId: {
              workspaceId: String(workspaceId),
              patientUserId: patientId,
            },
          },
          include: {
            assignedRoles: { include: { role: true } },
          },
        });

        if (!member || member.invitationStatus !== 'ACCEPTED') {
          res.status(403).json({ error: 'Not an active member of this workspace' });
          return;
        }

        const permSet = new Set<string>();
        if (member.isOwner || member.isAdmin) {
          ALL_PERMISSION_KEYS.forEach((k) => permSet.add(k));
        }
        member.assignedRoles.forEach((ar) =>
          ar.role.permissions.forEach((p) => permSet.add(p))
        );
        const myPerms = Array.from(permSet);

        const wsNotifications = await prisma.notification.findMany({
          where: {
            recipientWorkspaceId: String(workspaceId),
            OR: [
              { requiredPermission: null },
              { requiredPermission: { in: myPerms } },
            ],
          },
          orderBy: { createdAt: 'desc' },
          take: 40,
        });

        res.json({
          notifications: wsNotifications,
          unreadCount: wsNotifications.filter((n) => !n.isRead).length,
          filteredByPermissions: myPerms,
        });
        return;
      }

      // If viewing Doctor Notifications
      if (persona === 'DOCTOR' && req.user?.doctorId) {
        const docNotifications = await prisma.notification.findMany({
          where: {
            OR: [
              { recipientDoctorId: req.user.doctorId },
              {
                recipientPatientId: patientId,
                type: { in: ['DOCTOR_AFFILIATION', 'DGHS_STATUS_CHANGE'] },
              },
            ],
          },
          orderBy: { createdAt: 'desc' },
          take: 40,
        });

        res.json({
          notifications: docNotifications,
          unreadCount: docNotifications.filter((n) => !n.isRead).length,
        });
        return;
      }

      // Default: Patient Notifications (Prescriptions, Lab Reports, Billing Docs, Family Invites, Staff Invites)
      const patientNotifications = await prisma.notification.findMany({
        where: {
          recipientPatientId: targetPatientId,
        },
        orderBy: { createdAt: 'desc' },
        take: 40,
      });

      res.json({
        notifications: patientNotifications,
        unreadCount: patientNotifications.filter((n) => !n.isRead).length,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to load notifications' });
    }
  }
);

// 2. Mark Single Notification as Read
notificationsRouter.patch(
  '/:id/read',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const updated = await prisma.notification.update({
        where: { id: String(req.params.id) },
        data: { isRead: true },
      });
      res.json({ notification: updated });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to mark notification as read' });
    }
  }
);

// 3. Mark All Notifications as Read
notificationsRouter.post(
  '/read-all',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId, actingPatientId, persona } = req.body;
      const patientId = actingPatientId || req.user?.patientId;

      if (req.user?.isCentralRegistry || persona === 'CENTRAL_REGISTRY') {
        await prisma.notification.updateMany({
          where: { recipientCentralRegistry: true },
          data: { isRead: true },
        });
      } else if (workspaceId) {
        await prisma.notification.updateMany({
          where: { recipientWorkspaceId: String(workspaceId) },
          data: { isRead: true },
        });
      } else if (persona === 'DOCTOR' && req.user?.doctorId) {
        await prisma.notification.updateMany({
          where: {
            OR: [
              { recipientDoctorId: req.user.doctorId },
              ...(patientId ? [{ recipientPatientId: String(patientId) }] : []),
            ],
          },
          data: { isRead: true },
        });
      } else if (patientId) {
        await prisma.notification.updateMany({
          where: { recipientPatientId: String(patientId) },
          data: { isRead: true },
        });
      }

      res.json({ message: 'All notifications marked as read.' });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to mark all notifications as read' });
    }
  }
);
