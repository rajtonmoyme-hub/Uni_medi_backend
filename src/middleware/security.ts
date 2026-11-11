import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env';
import { prisma } from '../config/prisma';
import { ALL_PERMISSION_KEYS } from '../config/permissions';

export interface AuthTokenPayload {
  patientId?: string;
  uniqueId?: string;
  email: string;
  name: string;
  isCentralRegistry: boolean;
  doctorId?: string;
}

declare global {
  namespace Express {
    interface Request {
      params: Record<string, string>;
      user?: AuthTokenPayload;
      workspaceContext?: {
        workspaceId: string;
        memberId: string;
        isOwner: boolean;
        isAdmin: boolean;
        roleNames: string[];
        permissions: string[];
      };
    }
  }
}

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'test' ? 500 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many authentication attempts from this IP, please try again later.',
    code: 'RATE_LIMIT_AUTH',
  },
});

export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: process.env.NODE_ENV === 'test' ? 2000 : 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'API rate limit exceeded. Please slow down your requests.',
    code: 'RATE_LIMIT_API',
  },
});

export const qrRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 500 : 45,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many QR scan/generation requests. Please try again in a minute.',
    code: 'RATE_LIMIT_QR',
  },
});

export function signAuthToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as any,
  });
}

export async function authenticateToken(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication token required' });
      return;
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, env.JWT_SECRET) as AuthTokenPayload;

    if (!decoded.isCentralRegistry && decoded.patientId) {
      const patient = await prisma.patientUser.findUnique({
        where: { id: decoded.patientId },
        include: { doctorProfile: true },
      });

      if (!patient) {
        res.status(401).json({ error: 'Account no longer exists' });
        return;
      }

      if (patient.status === 'DISABLED') {
        res.status(403).json({
          error:
            'Your account has been disabled by the Central Registry (DGHS). Please contact DGHS support.',
          code: 'ACCOUNT_DISABLED',
        });
        return;
      }

      decoded.doctorId = patient.doctorProfile?.id;
    }

    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired authentication token' });
  }
}

export function requireCentralRegistry(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user || !req.user.isCentralRegistry) {
    res.status(403).json({
      error: 'Forbidden: Central Registry (DGHS) privileges required.',
    });
    return;
  }
  next();
}

export async function requireApprovedDoctor(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user?.patientId) {
    res.status(403).json({ error: 'Doctor profile required' });
    return;
  }

  const doctor = await prisma.doctorProfile.findUnique({
    where: { patientUserId: req.user.patientId },
  });

  if (!doctor) {
    res.status(403).json({ error: 'No Doctor profile associated with this account' });
    return;
  }

  if (doctor.approvalStatus !== 'APPROVED') {
    res.status(403).json({
      error: `Doctor account is currently ${doctor.approvalStatus}. Central Registry (DGHS) approval is required to perform clinical actions.`,
      approvalStatus: doctor.approvalStatus,
    });
    return;
  }

  req.user.doctorId = doctor.id;
  next();
}

export function requireWorkspacePermission(requiredPermission?: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const workspaceId = String(req.params.workspaceId || '');
      if (!workspaceId || !req.user?.patientId) {
        res.status(403).json({ error: 'Workspace context and patient identity required' });
        return;
      }

      const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
      });

      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      if (workspace.approvalStatus === 'DISABLED') {
        res.status(403).json({
          error: 'This Hospital/Workspace has been disabled by the Central Registry (DGHS).',
        });
        return;
      }

      const member = await prisma.workspaceMember.findUnique({
        where: {
          workspaceId_patientUserId: {
            workspaceId,
            patientUserId: req.user.patientId,
          },
        },
        include: {
          assignedRoles: {
            include: {
              role: true,
            },
          },
        },
      });

      if (!member || member.invitationStatus !== 'ACCEPTED') {
        res.status(403).json({
          error: 'You are not an active accepted member of this Workspace.',
        });
        return;
      }

      // Combine permissions across all assigned roles (Union)
      const combinedPermissionSet = new Set<string>();
      const roleNames: string[] = [];

      if (member.isOwner) {
        roleNames.push('Owner');
        ALL_PERMISSION_KEYS.forEach((k) => combinedPermissionSet.add(k));
      }
      if (member.isAdmin && !roleNames.includes('Admin')) {
        roleNames.push('Admin');
        ALL_PERMISSION_KEYS.forEach((k) => combinedPermissionSet.add(k));
      }

      for (const mr of member.assignedRoles) {
        if (!roleNames.includes(mr.role.name)) {
          roleNames.push(mr.role.name);
        }
        for (const perm of mr.role.permissions) {
          combinedPermissionSet.add(perm);
        }
      }

      const permissions = Array.from(combinedPermissionSet);

      if (requiredPermission && !permissions.includes(requiredPermission)) {
        res.status(403).json({
          error: `Forbidden: Missing required workspace permission '${requiredPermission}'`,
          requiredPermission,
          yourPermissions: permissions,
        });
        return;
      }

      req.workspaceContext = {
        workspaceId,
        memberId: member.id,
        isOwner: member.isOwner,
        isAdmin: member.isAdmin,
        roleNames,
        permissions,
      };

      next();
    } catch (err) {
      next(err);
    }
  };
}
