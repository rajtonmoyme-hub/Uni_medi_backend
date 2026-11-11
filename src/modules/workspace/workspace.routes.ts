import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../../config/prisma';
import {
  authenticateToken,
  requireWorkspacePermission,
} from '../../middleware/security';
import {
  WORKSPACE_PERMISSION_CATALOG,
  ALL_PERMISSION_KEYS,
} from '../../config/permissions';

export const workspaceRouter = Router();

workspaceRouter.use(authenticateToken);

// Helper to record immutable staff performance & activity log
async function logWorkspaceAction(params: {
  req: Request;
  action: string;
  category: string;
  description: string;
  targetType?: string;
  targetId?: string;
  metadata?: any;
}) {
  const { req, action, category, description, targetType, targetId, metadata } =
    params;
  if (!req.workspaceContext || !req.user?.patientId) return null;

  const entry = await prisma.workspaceAuditLog.create({
    data: {
      workspaceId: req.workspaceContext.workspaceId,
      actorMemberId: req.workspaceContext.memberId,
      actorPatientId: req.user.patientId,
      actorNameSnapshot: req.user.name,
      actorRolesSnapshot: req.workspaceContext.roleNames,
      action,
      category,
      targetType: targetType || null,
      targetId: targetId || null,
      description,
      metadata: metadata || undefined,
    },
  });

  if (process.env.NODE_ENV !== 'test') {
    console.info(
      `[WORKSPACE_AUDIT_LOG] [${entry.action}] WorkspaceId=${entry.workspaceId} Actor="${entry.actorNameSnapshot}" -> ${entry.description}`
    );
  }

  return entry;
}

// 0. Get Complete Permission Catalog (24 Permissions across 7 Domains)
workspaceRouter.get(
  '/permission-catalog',
  (_req: Request, res: Response): void => {
    res.json({
      permissions: WORKSPACE_PERMISSION_CATALOG,
      allKeys: ALL_PERMISSION_KEYS,
    });
  }
);

// 1. Get Workspace Context, Member's Assigned Roles, Combined Permissions, and Role-Scoped Metrics
workspaceRouter.get(
  '/:workspaceId/context',
  requireWorkspacePermission(),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId, memberId, permissions } = req.workspaceContext!;

      const [workspace, myMembership, roles] = await Promise.all([
        prisma.workspace.findUnique({
          where: { id: workspaceId },
          include: {
            owner: {
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
        prisma.workspaceMember.findUnique({
          where: { id: memberId },
          include: {
            patientUser: {
              select: {
                id: true,
                uniqueId: true,
                name: true,
                email: true,
                phone: true,
                profileAvatar: true,
                bloodGroup: true,
              },
            },
            assignedRoles: {
              include: { role: true },
            },
            auditLogs: {
              orderBy: { createdAt: 'desc' },
              take: 20,
            },
          },
        }),
        prisma.workspaceRole.findMany({
          where: { workspaceId },
          orderBy: { createdAt: 'asc' },
        }),
      ]);

      // Fetch counts only for domains the member is permitted to view
      const [
        staffCount,
        doctorsCount,
        appointmentsCount,
        pendingAppointmentsCount,
        reportsCount,
        billingDocsCount,
        packagesCount,
        auditLogsCount,
      ] = await Promise.all([
        permissions.includes('staff.view')
          ? prisma.workspaceMember.count({
              where: { workspaceId, invitationStatus: 'ACCEPTED' },
            })
          : Promise.resolve(null),
        permissions.includes('doctors.view')
          ? prisma.doctorWorkspaceAffiliation.count({
              where: { workspaceId, status: 'ACTIVE' },
            })
          : Promise.resolve(null),
        permissions.includes('appointments.view')
          ? prisma.appointment.count({ where: { workspaceId } })
          : Promise.resolve(null),
        permissions.includes('appointments.view')
          ? prisma.appointment.count({
              where: { workspaceId, status: 'PENDING' },
            })
          : Promise.resolve(null),
        permissions.includes('reports.view')
          ? prisma.vaultDocument.count({
              where: { workspaceId, type: 'LAB_REPORT' },
            })
          : Promise.resolve(null),
        permissions.includes('billing.view')
          ? prisma.vaultDocument.count({
              where: { workspaceId, type: 'BILLING_DOC' },
            })
          : Promise.resolve(null),
        permissions.includes('packages.view')
          ? prisma.healthPackage.count({ where: { workspaceId } })
          : Promise.resolve(null),
        permissions.includes('staff.logs.view')
          ? prisma.workspaceAuditLog.count({ where: { workspaceId } })
          : Promise.resolve(null),
      ]);

      res.json({
        workspace,
        myMembership,
        workspaceContext: req.workspaceContext,
        roles,
        permissionCatalog: WORKSPACE_PERMISSION_CATALOG,
        metrics: {
          staffCount,
          doctorsCount,
          appointmentsCount,
          pendingAppointmentsCount,
          reportsCount,
          billingDocsCount,
          packagesCount,
          auditLogsCount,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to load workspace context' });
    }
  }
);

// 2. Dynamic Roles Management — List Roles
workspaceRouter.get(
  '/:workspaceId/roles',
  requireWorkspacePermission(),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const roles = await prisma.workspaceRole.findMany({
        where: { workspaceId: String(req.params.workspaceId) },
        orderBy: { createdAt: 'asc' },
        include: {
          _count: {
            select: { memberRoles: true },
          },
        },
      });
      res.json({
        roles,
        permissionCatalog: WORKSPACE_PERMISSION_CATALOG,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to list workspace roles' });
    }
  }
);

// 3. Dynamic Roles Management — Create Custom Dynamic Role ('roles.manage')
workspaceRouter.post(
  '/:workspaceId/roles',
  requireWorkspacePermission('roles.manage'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId } = req.workspaceContext!;
      const { name, description, permissions } = req.body;

      if (!name || !Array.isArray(permissions) || permissions.length === 0) {
        res.status(400).json({
          error: 'Role name and at least one permission are required.',
        });
        return;
      }

      const cleanName = String(name).trim();
      if (['owner', 'admin'].includes(cleanName.toLowerCase())) {
        res.status(400).json({
          error: 'Owner and Admin are reserved system roles.',
        });
        return;
      }

      const validPermissions = permissions.filter((p: string) =>
        ALL_PERMISSION_KEYS.includes(p)
      );

      const role = await prisma.workspaceRole.create({
        data: {
          workspaceId,
          name: cleanName,
          description: description || `Custom role with ${validPermissions.length} permissions`,
          isSystemRole: false,
          permissions: validPermissions,
        },
      });

      await logWorkspaceAction({
        req,
        action: 'DYNAMIC_ROLE_CREATED',
        category: 'GOVERNANCE',
        targetType: 'ROLE',
        targetId: role.id,
        description: `Created dynamic role '${role.name}' with ${validPermissions.length} permissions`,
        metadata: { permissions: validPermissions },
      });

      res.status(201).json({
        message: `Dynamic role '${role.name}' created successfully.`,
        role,
      });
    } catch (err: any) {
      res.status(500).json({
        error: 'Failed to create dynamic role',
        details: err?.message,
      });
    }
  }
);

// 4. Dynamic Roles Management — Update Custom Dynamic Role ('roles.manage')
workspaceRouter.patch(
  '/:workspaceId/roles/:roleId',
  requireWorkspacePermission('roles.manage'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId } = req.workspaceContext!;
      const { name, description, permissions } = req.body;

      const existing = await prisma.workspaceRole.findFirst({
        where: { id: String(req.params.roleId), workspaceId },
      });

      if (!existing) {
        res.status(404).json({ error: 'Role not found' });
        return;
      }

      if (existing.isSystemRole) {
        res.status(403).json({
          error: 'System roles (Owner and Admin) cannot be modified.',
        });
        return;
      }

      const validPermissions = Array.isArray(permissions)
        ? permissions.filter((p: string) => ALL_PERMISSION_KEYS.includes(p))
        : existing.permissions;

      const updated = await prisma.workspaceRole.update({
        where: { id: existing.id },
        data: {
          name: name ? String(name).trim() : existing.name,
          description:
            description !== undefined ? description : existing.description,
          permissions: validPermissions,
        },
      });

      await logWorkspaceAction({
        req,
        action: 'DYNAMIC_ROLE_UPDATED',
        category: 'GOVERNANCE',
        targetType: 'ROLE',
        targetId: updated.id,
        description: `Updated dynamic role '${updated.name}' (${validPermissions.length} permissions)`,
        metadata: { permissions: validPermissions },
      });

      res.json({
        message: `Role '${updated.name}' updated.`,
        role: updated,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to update role' });
    }
  }
);

// 5. Dynamic Roles Management — Delete Custom Role ('roles.manage')
workspaceRouter.delete(
  '/:workspaceId/roles/:roleId',
  requireWorkspacePermission('roles.manage'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId } = req.workspaceContext!;
      const existing = await prisma.workspaceRole.findFirst({
        where: { id: String(req.params.roleId), workspaceId },
      });

      if (!existing) {
        res.status(404).json({ error: 'Role not found' });
        return;
      }

      if (existing.isSystemRole) {
        res.status(403).json({
          error: 'System roles (Owner and Admin) cannot be deleted.',
        });
        return;
      }

      await prisma.workspaceRole.delete({ where: { id: existing.id } });

      await logWorkspaceAction({
        req,
        action: 'DYNAMIC_ROLE_DELETED',
        category: 'GOVERNANCE',
        targetType: 'ROLE',
        targetId: existing.id,
        description: `Deleted custom role '${existing.name}'`,
      });

      res.json({ message: `Role '${existing.name}' deleted.` });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to delete role' });
    }
  }
);

// 6. Staff Directory & Performance Summary ('staff.view')
workspaceRouter.get(
  '/:workspaceId/staff',
  requireWorkspacePermission('staff.view'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId } = req.workspaceContext!;
      const members = await prisma.workspaceMember.findMany({
        where: { workspaceId },
        orderBy: [{ isOwner: 'desc' }, { isAdmin: 'desc' }, { createdAt: 'asc' }],
        include: {
          patientUser: {
            select: {
              id: true,
              uniqueId: true,
              name: true,
              email: true,
              phone: true,
              profileAvatar: true,
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
              createdPackages: true,
            },
          },
        },
      });

      const enrichedMembers = members.map((m) => {
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

      res.json({ staff: enrichedMembers });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to load workspace staff' });
    }
  }
);

// 7. Invite Staff Member (Mandatory Patient Account; Admin CANNOT add Owner or Admin!)
workspaceRouter.post(
  '/:workspaceId/staff/invite',
  requireWorkspacePermission('staff.invite'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId, isOwner } = req.workspaceContext!;
      const {
        patientIdentifier,
        roleIds = [],
        staffTitle,
        department,
        autoAcceptForDemo = false,
      } = req.body;

      if (!patientIdentifier || !Array.isArray(roleIds) || roleIds.length === 0) {
        res.status(400).json({
          error:
            'patientIdentifier (Unique ID, Email, or Phone) and at least one roleId are required.',
        });
        return;
      }

      const cleanId = String(patientIdentifier).trim();
      const targetPatient = await prisma.patientUser.findFirst({
        where: {
          OR: [
            { uniqueId: cleanId },
            { email: cleanId.toLowerCase() },
            { phone: cleanId },
          ],
        },
      });

      if (!targetPatient) {
        res.status(404).json({
          error:
            'No Patient account found matching that ID, Email, or Phone. Every workspace member MUST have a Patient account first.',
        });
        return;
      }

      const selectedRoles = await prisma.workspaceRole.findMany({
        where: {
          workspaceId,
          id: { in: roleIds.map(String) },
        },
      });

      if (selectedRoles.length === 0) {
        res.status(400).json({ error: 'No valid workspace roles selected.' });
        return;
      }

      const includesOwnerRole = selectedRoles.some(
        (r) => r.name.toLowerCase() === 'owner'
      );
      const includesAdminRole = selectedRoles.some(
        (r) => r.name.toLowerCase() === 'admin'
      );

      if (includesOwnerRole) {
        res.status(403).json({
          error:
            'Single Owner Policy: Cannot invite another Owner. Use Transfer Ownership if you wish to hand over primary ownership.',
        });
        return;
      }

      // Requirement 3: Admin has all permissions EXCEPT adding/removing Owner and adding/removing Admin!
      if (includesAdminRole && !isOwner) {
        res.status(403).json({
          error:
            'Forbidden: Only the Single Primary Owner can add or promote an Administrator.',
          code: 'ADMIN_CANNOT_ADD_ADMIN',
        });
        return;
      }

      const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
      });

      let member = await prisma.workspaceMember.findUnique({
        where: {
          workspaceId_patientUserId: {
            workspaceId,
            patientUserId: targetPatient.id,
          },
        },
      });

      const statusToSet = autoAcceptForDemo ? 'ACCEPTED' : 'PENDING';

      if (member) {
        if (member.isOwner) {
          res.status(400).json({
            error: 'This user is already the Primary Owner of this workspace.',
          });
          return;
        }

        member = await prisma.workspaceMember.update({
          where: { id: member.id },
          data: {
            isAdmin: includesAdminRole,
            staffTitle: staffTitle || member.staffTitle || 'Hospital Staff',
            department: department || member.department || 'General Operations',
            invitationStatus: statusToSet,
            invitedByPatientId: req.user!.patientId!,
            removedAt: null,
            joinedAt: autoAcceptForDemo ? new Date() : member.joinedAt,
          },
        });

        await prisma.workspaceMemberRole.deleteMany({
          where: { memberId: member.id },
        });
      } else {
        member = await prisma.workspaceMember.create({
          data: {
            workspaceId,
            patientUserId: targetPatient.id,
            isOwner: false,
            isAdmin: includesAdminRole,
            staffTitle: staffTitle || selectedRoles.map((r) => r.name).join(' & '),
            department: department || 'Hospital Operations',
            invitationStatus: statusToSet,
            invitedByPatientId: req.user!.patientId!,
            joinedAt: autoAcceptForDemo ? new Date() : null,
          },
        });
      }

      await Promise.all(
        selectedRoles.map((r) =>
          prisma.workspaceMemberRole.create({
            data: {
              memberId: member!.id,
              roleId: r.id,
            },
          })
        )
      );

      const roleNamesList = selectedRoles.map((r) => r.name);

      const auditLog = await logWorkspaceAction({
        req,
        action: 'STAFF_INVITED',
        category: 'STAFF',
        targetType: 'MEMBER',
        targetId: member.id,
        description: `Invited ${targetPatient.name} (${targetPatient.uniqueId}) with role(s): ${roleNamesList.join(', ')}`,
        metadata: {
          patientUniqueId: targetPatient.uniqueId,
          roles: roleNamesList,
        },
      });

      await prisma.notification.create({
        data: {
          recipientPatientId: targetPatient.id,
          type: 'STAFF_INVITATION',
          title: `Workspace Staff Invitation — ${workspace?.name}`,
          message: `You have been invited to join ${workspace?.name} with role(s): ${roleNamesList.join(', ')}.`,
          metadata: {
            workspaceId,
            memberId: member.id,
            roles: roleNamesList,
          },
        },
      });

      const fullMember = await prisma.workspaceMember.findUnique({
        where: { id: member.id },
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
          assignedRoles: { include: { role: true } },
        },
      });

      res.status(201).json({
        message: `Staff invitation sent to ${targetPatient.name} (${targetPatient.uniqueId}).`,
        member: fullMember,
        auditLog,
      });
    } catch (err: any) {
      res.status(500).json({
        error: 'Failed to invite staff member',
        details: err?.message,
      });
    }
  }
);

// 8. Assign / Update Multiple Roles for a Staff Member ('staff.assign_roles')
workspaceRouter.patch(
  '/:workspaceId/staff/:memberId/roles',
  requireWorkspacePermission('staff.assign_roles'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId, isOwner } = req.workspaceContext!;
      const { roleIds, staffTitle, department } = req.body;

      if (!Array.isArray(roleIds) || roleIds.length === 0) {
        res.status(400).json({ error: 'At least one roleId is required.' });
        return;
      }

      const targetMember = await prisma.workspaceMember.findFirst({
        where: { id: String(req.params.memberId), workspaceId },
        include: {
          patientUser: { select: { name: true, uniqueId: true } },
        },
      });

      if (!targetMember) {
        res.status(404).json({ error: 'Workspace member not found' });
        return;
      }

      if (targetMember.isOwner) {
        res.status(403).json({
          error: 'Cannot modify the Primary Owner role assignment directly.',
        });
        return;
      }

      if (targetMember.isAdmin && !isOwner) {
        res.status(403).json({
          error:
            'Forbidden: Only the Single Primary Owner can modify or demote an Administrator.',
          code: 'ADMIN_CANNOT_MODIFY_ADMIN',
        });
        return;
      }

      const selectedRoles = await prisma.workspaceRole.findMany({
        where: {
          workspaceId,
          id: { in: roleIds.map(String) },
        },
      });

      const includesOwnerRole = selectedRoles.some(
        (r) => r.name.toLowerCase() === 'owner'
      );
      const includesAdminRole = selectedRoles.some(
        (r) => r.name.toLowerCase() === 'admin'
      );

      if (includesOwnerRole) {
        res.status(403).json({
          error:
            'Cannot assign Owner role via role assignment. Use Transfer Ownership instead.',
        });
        return;
      }

      if (includesAdminRole && !isOwner) {
        res.status(403).json({
          error:
            'Forbidden: Only the Single Primary Owner can assign the Admin role.',
          code: 'ADMIN_CANNOT_ADD_ADMIN',
        });
        return;
      }

      await prisma.workspaceMemberRole.deleteMany({
        where: { memberId: targetMember.id },
      });

      await Promise.all(
        selectedRoles.map((r) =>
          prisma.workspaceMemberRole.create({
            data: {
              memberId: targetMember.id,
              roleId: r.id,
            },
          })
        )
      );

      const updated = await prisma.workspaceMember.update({
        where: { id: targetMember.id },
        data: {
          isAdmin: includesAdminRole,
          ...(staffTitle !== undefined ? { staffTitle } : {}),
          ...(department !== undefined ? { department } : {}),
        },
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
          assignedRoles: { include: { role: true } },
        },
      });

      const roleNames = selectedRoles.map((r) => r.name);

      await logWorkspaceAction({
        req,
        action: 'STAFF_ROLES_UPDATED',
        category: 'STAFF',
        targetType: 'MEMBER',
        targetId: updated.id,
        description: `Updated roles for ${targetMember.patientUser.name} (${targetMember.patientUser.uniqueId}) to: ${roleNames.join(', ')}`,
        metadata: { roles: roleNames },
      });

      res.json({
        message: `Roles updated to: ${roleNames.join(', ')}. Combined permissions are now active.`,
        member: updated,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to update staff roles' });
    }
  }
);

// 9. Remove Staff Member OR Revoke Pending Invitation ('staff.remove')
// Requirement 8: "if admin remove the staff , prev history should not be deleted ( admin can see all the prev logs )"
workspaceRouter.delete(
  '/:workspaceId/staff/:memberId',
  requireWorkspacePermission('staff.remove'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId, isOwner } = req.workspaceContext!;
      const targetMember = await prisma.workspaceMember.findFirst({
        where: { id: String(req.params.memberId), workspaceId },
        include: {
          patientUser: { select: { id: true, name: true, uniqueId: true } },
          assignedRoles: { include: { role: true } },
        },
      });

      if (!targetMember) {
        res.status(404).json({ error: 'Staff member not found' });
        return;
      }

      if (targetMember.isOwner) {
        res.status(403).json({
          error: 'Forbidden: The Single Primary Owner cannot be removed.',
          code: 'CANNOT_REMOVE_OWNER',
        });
        return;
      }

      if (targetMember.isAdmin && !isOwner) {
        res.status(403).json({
          error:
            'Forbidden: Only the Single Primary Owner can remove an Administrator.',
          code: 'ADMIN_CANNOT_REMOVE_ADMIN',
        });
        return;
      }

      // Soft-remove: sets invitationStatus = 'REMOVED' so all historical WorkspaceAuditLog records remain intact!
      const updated = await prisma.workspaceMember.update({
        where: { id: targetMember.id },
        data: {
          invitationStatus: 'REMOVED',
          isAdmin: false,
          removedAt: new Date(),
        },
      });

      await logWorkspaceAction({
        req,
        action: 'STAFF_REMOVED_HISTORY_PRESERVED',
        category: 'STAFF',
        targetType: 'MEMBER',
        targetId: targetMember.id,
        description: `Removed staff member ${targetMember.patientUser.name} (${targetMember.patientUser.uniqueId}). All historical performance and activity logs are permanently preserved.`,
        metadata: {
          previousRoles: targetMember.assignedRoles.map((r) => r.role.name),
        },
      });

      res.json({
        message: `${targetMember.patientUser.name} has been removed from active staff. All previous performance and activity logs have been preserved.`,
        member: updated,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to remove staff member' });
    }
  }
);

// 10. Transfer Primary Workspace Ownership (Decision 3: Single Owner with Transfer Ownership)
workspaceRouter.post(
  '/:workspaceId/transfer-ownership',
  requireWorkspacePermission(),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId, isOwner, memberId } = req.workspaceContext!;
      if (!isOwner) {
        res.status(403).json({
          error:
            'Forbidden: Only the current Single Primary Owner can transfer workspace ownership.',
        });
        return;
      }

      const { targetMemberId, password } = req.body;
      if (!targetMemberId || !password) {
        res.status(400).json({
          error:
            'targetMemberId and current Owner password are required to transfer ownership.',
        });
        return;
      }

      const ownerPatient = await prisma.patientUser.findUnique({
        where: { id: req.user!.patientId! },
      });

      if (!ownerPatient) {
        res.status(404).json({ error: 'Owner account not found' });
        return;
      }

      const validPass = await bcrypt.compare(
        String(password),
        ownerPatient.passwordHash
      );
      if (!validPass) {
        res.status(401).json({
          error: 'Invalid password. Ownership transfer requires password confirmation.',
        });
        return;
      }

      const targetMember = await prisma.workspaceMember.findFirst({
        where: {
          id: String(targetMemberId),
          workspaceId,
          invitationStatus: 'ACCEPTED',
        },
        include: {
          patientUser: { select: { id: true, name: true, uniqueId: true } },
        },
      });

      if (!targetMember) {
        res.status(404).json({
          error: 'Target member must be an active accepted member of this workspace.',
        });
        return;
      }

      if (targetMember.id === memberId) {
        res.status(400).json({ error: 'You are already the Primary Owner.' });
        return;
      }

      const [ownerRole, adminRole] = await Promise.all([
        prisma.workspaceRole.findFirst({
          where: { workspaceId, name: 'Owner' },
        }),
        prisma.workspaceRole.findFirst({
          where: { workspaceId, name: 'Admin' },
        }),
      ]);

      await prisma.$transaction([
        prisma.workspace.update({
          where: { id: workspaceId },
          data: { ownerPatientId: targetMember.patientUserId },
        }),
        prisma.workspaceMember.update({
          where: { id: memberId },
          data: {
            isOwner: false,
            isAdmin: true,
            staffTitle: 'Former Owner / Senior Admin',
          },
        }),
        prisma.workspaceMember.update({
          where: { id: targetMember.id },
          data: {
            isOwner: true,
            isAdmin: true,
            staffTitle: 'Primary Owner',
          },
        }),
      ]);

      if (ownerRole && adminRole) {
        await prisma.workspaceMemberRole.deleteMany({
          where: { memberId, roleId: ownerRole.id },
        });
        await prisma.workspaceMemberRole.upsert({
          where: {
            memberId_roleId: { memberId, roleId: adminRole.id },
          },
          update: {},
          create: { memberId, roleId: adminRole.id },
        });
        await prisma.workspaceMemberRole.upsert({
          where: {
            memberId_roleId: {
              memberId: targetMember.id,
              roleId: ownerRole.id,
            },
          },
          update: {},
          create: { memberId: targetMember.id, roleId: ownerRole.id },
        });
      }

      await logWorkspaceAction({
        req,
        action: 'OWNERSHIP_TRANSFERRED',
        category: 'GOVERNANCE',
        targetType: 'MEMBER',
        targetId: targetMember.id,
        description: `Transferred Single Primary Ownership from ${ownerPatient.name} (${ownerPatient.uniqueId}) to ${targetMember.patientUser.name} (${targetMember.patientUser.uniqueId}).`,
      });

      res.json({
        message: `Primary Ownership successfully transferred to ${targetMember.patientUser.name}. You are now an Administrator.`,
      });
    } catch (err: any) {
      res.status(500).json({
        error: 'Failed to transfer ownership',
        details: err?.message,
      });
    }
  }
);

// 11. Immutable Staff Performance & Audit Logs ('staff.logs.view')
workspaceRouter.get(
  '/:workspaceId/audit-logs',
  requireWorkspacePermission('staff.logs.view'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId } = req.workspaceContext!;
      const { actorMemberId, category } = req.query;

      const where: any = { workspaceId };
      if (actorMemberId) where.actorMemberId = String(actorMemberId);
      if (category && String(category) !== 'ALL') {
        where.category = String(category);
      }

      const [logs, allMembersIncludingRemoved] = await Promise.all([
        prisma.workspaceAuditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: 150,
          include: {
            actorMember: {
              select: {
                id: true,
                staffTitle: true,
                invitationStatus: true,
                removedAt: true,
              },
            },
          },
        }),
        prisma.workspaceMember.findMany({
          where: { workspaceId },
          include: {
            patientUser: {
              select: { id: true, uniqueId: true, name: true, email: true },
            },
            assignedRoles: { include: { role: true } },
            _count: {
              select: {
                auditLogs: true,
                uploadedDocuments: true,
                managedAppointments: true,
                createdPackages: true,
              },
            },
          },
        }),
      ]);

      res.json({
        logs,
        staffPerformanceSummary: allMembersIncludingRemoved.map((m) => ({
          memberId: m.id,
          patientId: m.patientUserId,
          uniqueId: m.patientUser.uniqueId,
          name: m.patientUser.name,
          email: m.patientUser.email,
          staffTitle: m.staffTitle,
          status: m.invitationStatus, // Includes 'REMOVED' staff so their history is never lost!
          roles: m.assignedRoles.map((r) => r.role.name),
          joinedAt: m.joinedAt,
          removedAt: m.removedAt,
          metrics: {
            totalLoggedActions: m._count.auditLogs,
            documentsUploaded: m._count.uploadedDocuments,
            appointmentsManaged: m._count.managedAppointments,
            packagesCreated: m._count.createdPackages,
          },
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to load staff performance logs' });
    }
  }
);

// 12. Doctor Affiliations in Workspace ('doctors.view')
workspaceRouter.get(
  '/:workspaceId/doctors',
  requireWorkspacePermission('doctors.view'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId } = req.workspaceContext!;
      const [affiliations, directoryDoctors] = await Promise.all([
        prisma.doctorWorkspaceAffiliation.findMany({
          where: { workspaceId },
          orderBy: { createdAt: 'desc' },
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
        }),
        prisma.doctorProfile.findMany({
          where: { approvalStatus: 'APPROVED' },
          include: {
            patientUser: {
              select: { id: true, uniqueId: true, name: true, email: true, phone: true },
            },
          },
        }),
      ]);

      res.json({
        affiliations,
        directoryDoctors,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to load workspace doctors' });
    }
  }
);

// 13. Workspace Invites a Doctor for Affiliation ('doctors.invite')
workspaceRouter.post(
  '/:workspaceId/doctors/invite',
  requireWorkspacePermission('doctors.invite'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId } = req.workspaceContext!;
      const {
        doctorIdentifier,
        consultationFee = 1000,
        schedule = 'Sun, Tue, Thu: 5:00 PM - 9:00 PM',
        roomNumber = 'Room 302',
        department,
      } = req.body;

      if (!doctorIdentifier) {
        res.status(400).json({
          error:
            'doctorIdentifier (Doctor ID, License, or Email) is required.',
        });
        return;
      }

      const cleanId = String(doctorIdentifier).trim();
      const doctor = await prisma.doctorProfile.findFirst({
        where: {
          OR: [
            { id: cleanId },
            { doctorIdCode: cleanId },
            { doctorLicense: cleanId },
            { patientUser: { email: cleanId.toLowerCase() } },
            { patientUser: { uniqueId: cleanId } },
          ],
        },
        include: {
          patientUser: { select: { id: true, name: true, uniqueId: true } },
        },
      });

      if (!doctor) {
        res.status(404).json({ error: 'Doctor not found.' });
        return;
      }

      const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
      });

      const affiliation = await prisma.doctorWorkspaceAffiliation.upsert({
        where: {
          doctorId_workspaceId: {
            doctorId: doctor.id,
            workspaceId,
          },
        },
        update: {
          initiatedBy: 'WORKSPACE',
          statusUpdatedBy: 'WORKSPACE',
          status: 'PENDING',
          consultationFee: Number(consultationFee) || 1000,
          schedule: String(schedule),
          roomNumber: roomNumber || null,
          department: department || doctor.specialty,
        },
        create: {
          doctorId: doctor.id,
          workspaceId,
          initiatedBy: 'WORKSPACE',
          statusUpdatedBy: 'WORKSPACE',
          status: 'PENDING',
          consultationFee: Number(consultationFee) || 1000,
          schedule: String(schedule),
          roomNumber: roomNumber || null,
          department: department || doctor.specialty,
        },
        include: {
          doctor: {
            include: {
              patientUser: { select: { name: true, email: true, phone: true } },
            },
          },
        },
      });

      const auditLog = await logWorkspaceAction({
        req,
        action: 'DOCTOR_INVITED',
        category: 'DOCTORS',
        targetType: 'DOCTOR',
        targetId: doctor.id,
        description: `Sent affiliation invitation to ${doctor.patientUser.name} (${doctor.doctorIdCode}) with fee ${affiliation.consultationFee} BDT`,
      });

      await prisma.notification.create({
        data: {
          recipientPatientId: doctor.patientUserId,
          recipientDoctorId: doctor.id,
          type: 'DOCTOR_AFFILIATION',
          title: `Hospital Affiliation Invitation — ${workspace?.name}`,
          message: `${workspace?.name} invited you to affiliate as ${doctor.specialty} consultant (Fee: ${affiliation.consultationFee} BDT, Schedule: ${affiliation.schedule}).`,
          metadata: { affiliationId: affiliation.id, workspaceId },
        },
      });

      res.status(201).json({
        message: `Affiliation invitation sent to ${doctor.patientUser.name}.`,
        affiliation,
        auditLog,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to invite doctor' });
    }
  }
);

// 14. Workspace Accepts/Rejects/Revokes Doctor Affiliation or Updates Schedule & Fee
workspaceRouter.patch(
  '/:workspaceId/doctors/:affiliationId',
  requireWorkspacePermission('doctors.view'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId, permissions } = req.workspaceContext!;
      const { status, consultationFee, schedule, roomNumber, department } =
        req.body;

      const aff = await prisma.doctorWorkspaceAffiliation.findFirst({
        where: {
          id: String(req.params.affiliationId),
          workspaceId,
        },
        include: {
          doctor: {
            include: { patientUser: { select: { id: true, name: true } } },
          },
        },
      });

      if (!aff) {
        res.status(404).json({ error: 'Doctor affiliation not found' });
        return;
      }

      if (status === 'REVOKED' && !permissions.includes('doctors.revoke')) {
        res.status(403).json({
          error: "Missing permission 'doctors.revoke' to terminate doctor affiliation.",
        });
        return;
      }

      if (
        (status === 'ACTIVE' || status === 'REJECTED' || status === 'PENDING') &&
        !permissions.includes('doctors.invite')
      ) {
        res.status(403).json({
          error: "Missing permission 'doctors.invite' to approve/reject/re-invite doctor affiliation.",
        });
        return;
      }

      if (
        status === 'ACTIVE' &&
        aff.status === 'REVOKED' &&
        aff.statusUpdatedBy === 'DOCTOR'
      ) {
        res.status(400).json({
          error:
            'This affiliation was revoked by the Doctor. Send a Re-invitation (PENDING) so the Doctor can accept.',
        });
        return;
      }

      if (
        (consultationFee !== undefined ||
          schedule !== undefined ||
          roomNumber !== undefined) &&
        !permissions.includes('doctors.schedule') &&
        !permissions.includes('doctors.invite')
      ) {
        res.status(403).json({
          error: "Missing permission 'doctors.schedule' to update doctor schedule/fee.",
        });
        return;
      }

      const updated = await prisma.doctorWorkspaceAffiliation.update({
        where: { id: aff.id },
        data: {
          ...(status
            ? {
                status,
                statusUpdatedBy: 'WORKSPACE',
                ...(status === 'PENDING' ? { initiatedBy: 'WORKSPACE' } : {}),
              }
            : {}),
          ...(consultationFee !== undefined
            ? { consultationFee: Number(consultationFee) }
            : {}),
          ...(schedule !== undefined ? { schedule: String(schedule) } : {}),
          ...(roomNumber !== undefined ? { roomNumber } : {}),
          ...(department !== undefined ? { department } : {}),
        },
        include: {
          doctor: {
            include: {
              patientUser: { select: { name: true, email: true, phone: true } },
            },
          },
        },
      });

      const actionLabel = status
        ? status === 'ACTIVE' && aff.status === 'REVOKED'
          ? 'DOCTOR_AFFILIATION_RESTORED'
          : `DOCTOR_AFFILIATION_${status}`
        : 'DOCTOR_SCHEDULE_UPDATED';

      const auditLog = await logWorkspaceAction({
        req,
        action: actionLabel,
        category: 'DOCTORS',
        targetType: 'AFFILIATION',
        targetId: updated.id,
        description: `Updated affiliation for ${aff.doctor.patientUser.name} (Status: ${updated.status}, Fee: ${updated.consultationFee} BDT, Schedule: ${updated.schedule})`,
      });

      if (status) {
        await prisma.notification.create({
          data: {
            recipientPatientId: aff.doctor.patientUser.id,
            recipientDoctorId: aff.doctorId,
            type: 'DOCTOR_AFFILIATION',
            title: `Hospital Affiliation Status: ${updated.status}`,
            message: `Facility updated your consultant affiliation status to ${updated.status} (Fee: ${updated.consultationFee} BDT).`,
            metadata: { affiliationId: updated.id, workspaceId },
          },
        });
      }

      res.json({
        message: 'Doctor affiliation updated.',
        affiliation: updated,
        auditLog,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to update doctor affiliation' });
    }
  }
);

// 15. Patient Lookup by Unique ID, Phone, or Email ('patients.lookup')
workspaceRouter.get(
  '/:workspaceId/patients/lookup',
  requireWorkspacePermission('patients.lookup'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { q } = req.query;
      if (!q || !String(q).trim()) {
        const recentPatients = await prisma.patientUser.findMany({
          where: { status: 'ACTIVE' },
          take: 15,
          orderBy: { createdAt: 'desc' },
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
        });
        res.json({ patients: recentPatients });
        return;
      }

      const query = String(q).trim();
      const patients = await prisma.patientUser.findMany({
        where: {
          status: 'ACTIVE',
          OR: [
            { uniqueId: { contains: query, mode: 'insensitive' } },
            { name: { contains: query, mode: 'insensitive' } },
            { phone: { contains: query, mode: 'insensitive' } },
            { email: { contains: query, mode: 'insensitive' } },
          ],
        },
        take: 15,
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
      });

      res.json({ patients });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to lookup patients' });
    }
  }
);

// 16. Front Desk & Appointments — View Appointments ('appointments.view')
workspaceRouter.get(
  '/:workspaceId/appointments',
  requireWorkspacePermission('appointments.view'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId } = req.workspaceContext!;
      const { status, doctorId } = req.query;

      const where: any = { workspaceId };
      if (status && String(status) !== 'ALL') where.status = String(status);
      if (doctorId && String(doctorId) !== 'ALL')
        where.doctorId = String(doctorId);

      const appointments = await prisma.appointment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
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
              accountType: true,
            },
          },
          doctor: {
            include: {
              patientUser: { select: { name: true, phone: true } },
            },
          },
          managedByMember: {
            include: {
              patientUser: { select: { name: true } },
            },
          },
        },
      });

      res.json({ appointments });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to load workspace appointments' });
    }
  }
);

// 17. Front Desk & Appointments — Workspace Staff Approves / Manages Appointment (Decision 7b: 'appointments.manage')
workspaceRouter.patch(
  '/:workspaceId/appointments/:appointmentId',
  requireWorkspacePermission('appointments.manage'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId, memberId } = req.workspaceContext!;
      const { status, timeSlot, appointmentDate, serialNumber, notes } =
        req.body;

      const apt = await prisma.appointment.findFirst({
        where: {
          id: String(req.params.appointmentId),
          workspaceId,
        },
        include: {
          patient: { select: { id: true, name: true, uniqueId: true } },
          doctor: { include: { patientUser: { select: { name: true } } } },
          workspace: { select: { name: true } },
        },
      });

      if (!apt) {
        res.status(404).json({ error: 'Appointment not found' });
        return;
      }

      const updated = await prisma.appointment.update({
        where: { id: apt.id },
        data: {
          ...(status ? { status } : {}),
          ...(timeSlot !== undefined ? { timeSlot } : {}),
          ...(appointmentDate !== undefined ? { appointmentDate } : {}),
          ...(serialNumber !== undefined
            ? { serialNumber: Number(serialNumber) }
            : {}),
          ...(notes !== undefined ? { notes } : {}),
          managedByMemberId: memberId,
        },
        include: {
          patient: {
            select: { id: true, uniqueId: true, name: true, phone: true },
          },
          doctor: {
            include: { patientUser: { select: { name: true } } },
          },
        },
      });

      const auditLog = await logWorkspaceAction({
        req,
        action: `APPOINTMENT_${updated.status}`,
        category: 'APPOINTMENTS',
        targetType: 'APPOINTMENT',
        targetId: updated.id,
        description: `Updated appointment ${apt.appointmentCode} for patient ${apt.patient.name} (${apt.patient.uniqueId}) with ${apt.doctor.patientUser.name} to status ${updated.status}`,
      });

      await prisma.notification.create({
        data: {
          recipientPatientId: apt.patientId,
          type: 'APPOINTMENT_UPDATE',
          title: `Appointment ${updated.status} — ${apt.workspace?.name || 'Facility'}`,
          message: `Your appointment (${apt.appointmentCode}) with ${apt.doctor.patientUser.name} on ${updated.appointmentDate} (${updated.timeSlot}) is now ${updated.status}.${updated.serialNumber ? ` Serial #${updated.serialNumber}.` : ''}`,
          metadata: { appointmentId: updated.id },
        },
      });

      res.json({
        message: `Appointment ${apt.appointmentCode} updated to ${updated.status}.`,
        appointment: updated,
        auditLog,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to update appointment' });
    }
  }
);

// 18. Diagnostics & Lab Reports — View Uploaded Lab Reports ('reports.view')
workspaceRouter.get(
  '/:workspaceId/reports',
  requireWorkspacePermission('reports.view'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId } = req.workspaceContext!;
      const reports = await prisma.vaultDocument.findMany({
        where: {
          workspaceId,
          type: 'LAB_REPORT',
        },
        orderBy: { createdAt: 'desc' },
        include: {
          patient: {
            select: {
              id: true,
              uniqueId: true,
              name: true,
              email: true,
              phone: true,
              bloodGroup: true,
            },
          },
          doctor: {
            include: { patientUser: { select: { name: true } } },
          },
          uploadedByMember: {
            include: { patientUser: { select: { name: true } } },
          },
        },
      });

      res.json({ reports });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to load workspace lab reports' });
    }
  }
);

// 19. Diagnostics & Lab Reports — Upload Diagnostic Report to Patient Vault ('reports.upload')
workspaceRouter.post(
  '/:workspaceId/reports',
  requireWorkspacePermission('reports.upload'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId, memberId, permissions } = req.workspaceContext!;
      const {
        patientIdentifier,
        title,
        testCategory = 'Pathology & Hematology',
        parameters = [],
        conclusion,
        referredByDoctorId,
        fileUrl,
        verified = true,
      } = req.body;

      if (!patientIdentifier || !title) {
        res.status(400).json({
          error: 'patientIdentifier and report title are required.',
        });
        return;
      }

      const cleanId = String(patientIdentifier).trim();
      const patient = await prisma.patientUser.findFirst({
        where: {
          OR: [
            { id: cleanId },
            { uniqueId: cleanId },
            { email: cleanId.toLowerCase() },
            { phone: cleanId },
          ],
        },
      });

      if (!patient) {
        res.status(404).json({
          error: 'Patient not found with that ID, email, or phone.',
        });
        return;
      }

      const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
      });

      let doctorNameSnapshot: string | null = null;
      if (referredByDoctorId) {
        const doc = await prisma.doctorProfile.findUnique({
          where: { id: String(referredByDoctorId) },
          include: { patientUser: true },
        });
        if (doc) doctorNameSnapshot = doc.patientUser.name;
      }

      const documentCode = `LAB-2026-${Math.floor(100000 + Math.random() * 900000)}`;
      const isVerified =
        Boolean(verified) && permissions.includes('reports.verify');

      const report = await prisma.vaultDocument.create({
        data: {
          documentCode,
          patientId: patient.id,
          type: 'LAB_REPORT',
          title: String(title).trim(),
          summary:
            conclusion ||
            `${testCategory} report uploaded by ${workspace?.name}`,
          doctorId: referredByDoctorId ? String(referredByDoctorId) : null,
          doctorNameSnapshot,
          workspaceId,
          workspaceNameSnapshot: workspace?.name || 'Diagnostic Center',
          uploadedByMemberId: memberId,
          fileUrl: fileUrl || null,
          structuredData: {
            testCategory,
            parameters: Array.isArray(parameters)
              ? parameters
              : [
                  {
                    name: 'Hemoglobin (Hb)',
                    result: '14.2 g/dL',
                    referenceRange: '13.0 - 17.0 g/dL',
                    flag: 'NORMAL',
                  },
                ],
            conclusion:
              conclusion ||
              'All measured parameters are within normal physiological reference ranges.',
            verified: isVerified,
            verifiedBy: isVerified ? req.user?.name : null,
            uploadedAt: new Date().toISOString(),
          },
        },
        include: {
          patient: {
            select: { id: true, uniqueId: true, name: true, email: true },
          },
        },
      });

      await logWorkspaceAction({
        req,
        action: 'LAB_REPORT_UPLOADED',
        category: 'REPORTS',
        targetType: 'DOCUMENT',
        targetId: report.id,
        description: `Uploaded diagnostic report '${report.title}' (${documentCode}) for patient ${patient.name} (${patient.uniqueId})`,
      });

      await prisma.patientActivityLog.create({
        data: {
          patientId: patient.id,
          action: 'REPORT_UPLOADED',
          description: `Diagnostic report '${report.title}' (${documentCode}) uploaded by ${workspace?.name}`,
        },
      });

      // Notify Patient at top navbar notification section!
      await prisma.notification.create({
        data: {
          recipientPatientId: patient.id,
          type: 'LAB_REPORT_READY',
          title: `New Diagnostic Report from ${workspace?.name}`,
          message: `Your diagnostic report '${report.title}' (${documentCode}) has been uploaded to your Report & Prescription Vault by ${workspace?.name}.`,
          metadata: {
            documentId: report.id,
            documentCode,
            workspaceName: workspace?.name,
          },
        },
      });

      res.status(201).json({
        message: `Diagnostic report ${documentCode} uploaded to ${patient.name}'s Vault and notification sent.`,
        report,
      });
    } catch (err: any) {
      res.status(500).json({
        error: 'Failed to upload diagnostic report',
        details: err?.message,
      });
    }
  }
);

// 20. Billing & Finance — View Workspace Invoices ('billing.view')
workspaceRouter.get(
  '/:workspaceId/billing',
  requireWorkspacePermission('billing.view'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId } = req.workspaceContext!;
      const invoices = await prisma.vaultDocument.findMany({
        where: {
          workspaceId,
          type: 'BILLING_DOC',
        },
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
          uploadedByMember: {
            include: { patientUser: { select: { name: true } } },
          },
        },
      });

      res.json({ invoices });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to load workspace billing invoices' });
    }
  }
);

// 21. Billing & Finance — Create Billing Document & Send to Patient Vault ('billing.create')
workspaceRouter.post(
  '/:workspaceId/billing',
  requireWorkspacePermission('billing.create'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId, memberId } = req.workspaceContext!;
      const {
        patientIdentifier,
        title,
        items = [],
        discount = 0,
        paymentStatus = 'PAID',
        paymentMethod = 'Cash / Digital Payment',
        notes,
      } = req.body;

      if (!patientIdentifier || !Array.isArray(items) || items.length === 0) {
        res.status(400).json({
          error: 'patientIdentifier and at least one billing line item are required.',
        });
        return;
      }

      const cleanId = String(patientIdentifier).trim();
      const patient = await prisma.patientUser.findFirst({
        where: {
          OR: [
            { id: cleanId },
            { uniqueId: cleanId },
            { email: cleanId.toLowerCase() },
            { phone: cleanId },
          ],
        },
      });

      if (!patient) {
        res.status(404).json({ error: 'Patient account not found.' });
        return;
      }

      const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
      });

      const subtotal = items.reduce(
        (sum: number, item: any) =>
          sum + Number(item.amount || item.price || 0) * Number(item.qty || 1),
        0
      );
      const discountAmount = Number(discount) || 0;
      const totalAmount = Math.max(0, subtotal - discountAmount);

      const documentCode = `INV-2026-${Math.floor(100000 + Math.random() * 900000)}`;

      const invoice = await prisma.vaultDocument.create({
        data: {
          documentCode,
          patientId: patient.id,
          type: 'BILLING_DOC',
          title:
            title || `Medical Invoice — ${workspace?.name} (${totalAmount} BDT)`,
          summary: `Total: ${totalAmount} BDT (${paymentStatus})`,
          workspaceId,
          workspaceNameSnapshot: workspace?.name || 'Hospital Billing',
          uploadedByMemberId: memberId,
          structuredData: {
            invoiceNumber: documentCode,
            items,
            subtotal,
            discount: discountAmount,
            totalAmount,
            currency: 'BDT',
            paymentStatus,
            paymentMethod,
            notes: notes || 'Thank you for choosing our healthcare services.',
            issuedByStaff: req.user?.name,
            issuedAt: new Date().toISOString(),
          },
        },
        include: {
          patient: {
            select: { id: true, uniqueId: true, name: true, email: true },
          },
        },
      });

      await logWorkspaceAction({
        req,
        action: 'BILLING_INVOICE_CREATED',
        category: 'BILLING',
        targetType: 'DOCUMENT',
        targetId: invoice.id,
        description: `Created billing invoice ${documentCode} (${totalAmount} BDT, ${paymentStatus}) for patient ${patient.name} (${patient.uniqueId})`,
        metadata: { totalAmount, paymentStatus },
      });

      // Notify Patient at top navbar notification section!
      await prisma.notification.create({
        data: {
          recipientPatientId: patient.id,
          type: 'BILLING_INVOICE',
          title: `New Billing Statement from ${workspace?.name}`,
          message: `Billing document ${documentCode} for ${totalAmount} BDT (${paymentStatus}) has been added to your Vault by ${workspace?.name}.`,
          metadata: {
            documentId: invoice.id,
            documentCode,
            totalAmount,
            workspaceName: workspace?.name,
          },
        },
      });

      res.status(201).json({
        message: `Billing invoice ${documentCode} sent to ${patient.name}'s Vault and notification delivered.`,
        invoice,
      });
    } catch (err: any) {
      res.status(500).json({
        error: 'Failed to create billing invoice',
        details: err?.message,
      });
    }
  }
);

// 22. Promotional Health Packages — List Packages ('packages.view')
workspaceRouter.get(
  '/:workspaceId/packages',
  requireWorkspacePermission('packages.view'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const packages = await prisma.healthPackage.findMany({
        where: { workspaceId: String(req.params.workspaceId) },
        orderBy: { createdAt: 'desc' },
      });
      res.json({ packages });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to load health packages' });
    }
  }
);

// 23. Promotional Health Packages — Create Package ('packages.manage', e.g. "Full Body Checkup - Only 10,000 Tk")
workspaceRouter.post(
  '/:workspaceId/packages',
  requireWorkspacePermission('packages.manage'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId, memberId } = req.workspaceContext!;
      const {
        title,
        tagline,
        description,
        price,
        originalPrice,
        includedTests = [],
        bannerImage,
        durationLabel,
        isFeatured = true,
      } = req.body;

      if (!title || price === undefined) {
        res.status(400).json({
          error: 'Package title and price are required.',
        });
        return;
      }

      const packageCode = `PKG-2026-${Math.floor(10000 + Math.random() * 90000)}`;
      const parsedTests = Array.isArray(includedTests)
        ? includedTests
        : String(includedTests)
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);

      const pkg = await prisma.healthPackage.create({
        data: {
          packageCode,
          workspaceId,
          title: String(title).trim(),
          tagline: tagline || `Comprehensive Screening — Only ${price} Tk`,
          description:
            description ||
            'Complete preventive health screening with specialist consultation.',
          price: Number(price),
          originalPrice: originalPrice ? Number(originalPrice) : null,
          includedTests: parsedTests,
          bannerImage: bannerImage || null,
          durationLabel: durationLabel || 'Same Day Report Delivery',
          isFeatured: Boolean(isFeatured),
          isActive: true,
          createdByMemberId: memberId,
        },
      });

      await logWorkspaceAction({
        req,
        action: 'HEALTH_PACKAGE_CREATED',
        category: 'PACKAGES',
        targetType: 'PACKAGE',
        targetId: pkg.id,
        description: `Published health package '${pkg.title}' (${pkg.price} BDT)`,
      });

      res.status(201).json({
        message: `Health package '${pkg.title}' published successfully.`,
        package: pkg,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to create health package' });
    }
  }
);

// 24. Promotional Health Packages — Update / Toggle Package ('packages.manage')
workspaceRouter.patch(
  '/:workspaceId/packages/:packageId',
  requireWorkspacePermission('packages.manage'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId } = req.workspaceContext!;
      const {
        title,
        tagline,
        description,
        price,
        originalPrice,
        includedTests,
        isActive,
        isFeatured,
      } = req.body;

      const existing = await prisma.healthPackage.findFirst({
        where: { id: String(req.params.packageId), workspaceId },
      });

      if (!existing) {
        res.status(404).json({ error: 'Package not found' });
        return;
      }

      const updated = await prisma.healthPackage.update({
        where: { id: existing.id },
        data: {
          ...(title !== undefined ? { title: String(title).trim() } : {}),
          ...(tagline !== undefined ? { tagline } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(price !== undefined ? { price: Number(price) } : {}),
          ...(originalPrice !== undefined
            ? { originalPrice: originalPrice ? Number(originalPrice) : null }
            : {}),
          ...(includedTests !== undefined
            ? {
                includedTests: Array.isArray(includedTests)
                  ? includedTests
                  : String(includedTests)
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
              }
            : {}),
          ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
          ...(isFeatured !== undefined
            ? { isFeatured: Boolean(isFeatured) }
            : {}),
        },
      });

      await logWorkspaceAction({
        req,
        action: 'HEALTH_PACKAGE_UPDATED',
        category: 'PACKAGES',
        targetType: 'PACKAGE',
        targetId: updated.id,
        description: `Updated health package '${updated.title}' (${updated.price} BDT, Active: ${updated.isActive})`,
      });

      res.json({
        message: 'Health package updated.',
        package: updated,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to update health package' });
    }
  }
);

// 25. Workspace Profile Settings ('workspace.profile.edit') & Staff Personal Profile
workspaceRouter.patch(
  '/:workspaceId/profile',
  requireWorkspacePermission('workspace.profile.edit'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workspaceId } = req.workspaceContext!;
      const {
        name,
        email,
        phone,
        address,
        area,
        description,
        departments,
        operatingHours,
        logoUrl,
        bannerUrl,
      } = req.body;

      const updated = await prisma.workspace.update({
        where: { id: workspaceId },
        data: {
          ...(name !== undefined ? { name: String(name).trim() } : {}),
          ...(email !== undefined
            ? { email: String(email).trim().toLowerCase() }
            : {}),
          ...(phone !== undefined ? { phone: String(phone).trim() } : {}),
          ...(address !== undefined ? { address: String(address).trim() } : {}),
          ...(area !== undefined ? { area: String(area).trim() } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(departments !== undefined
            ? {
                departments: Array.isArray(departments)
                  ? departments
                  : String(departments)
                      .split(',')
                      .map((d) => d.trim())
                      .filter(Boolean),
              }
            : {}),
          ...(operatingHours !== undefined ? { operatingHours } : {}),
          ...(logoUrl !== undefined ? { logoUrl } : {}),
          ...(bannerUrl !== undefined ? { bannerUrl } : {}),
        },
      });

      await logWorkspaceAction({
        req,
        action: 'WORKSPACE_PROFILE_UPDATED',
        category: 'GOVERNANCE',
        targetType: 'WORKSPACE',
        targetId: workspaceId,
        description: `Updated workspace profile settings for ${updated.name}`,
      });

      res.json({
        message: 'Workspace profile updated.',
        workspace: updated,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to update workspace profile' });
    }
  }
);

// 26. Staff Member's Own Profile in Workspace (Requirement 10: "There will be Profile section for each staff(admin/ owner / receptionist and others)")
workspaceRouter.patch(
  '/:workspaceId/my-staff-profile',
  requireWorkspacePermission(),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { memberId } = req.workspaceContext!;
      const { staffTitle, department, name, phone, profileAvatar } = req.body;

      const updatedMember = await prisma.workspaceMember.update({
        where: { id: memberId },
        data: {
          ...(staffTitle !== undefined ? { staffTitle } : {}),
          ...(department !== undefined ? { department } : {}),
        },
      });

      if (
        name !== undefined ||
        phone !== undefined ||
        profileAvatar !== undefined
      ) {
        await prisma.patientUser.update({
          where: { id: req.user!.patientId! },
          data: {
            ...(name !== undefined ? { name: String(name).trim() } : {}),
            ...(phone !== undefined ? { phone: String(phone).trim() } : {}),
            ...(profileAvatar !== undefined ? { profileAvatar } : {}),
          },
        });
      }

      res.json({
        message: 'Your staff profile has been updated.',
        membership: updatedMember,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to update staff profile' });
    }
  }
);
