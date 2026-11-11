import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { apiRateLimiter } from './middleware/security';
import { authRouter } from './modules/auth/auth.routes';
import { centralRegistryRouter } from './modules/central-registry/central-registry.routes';
import { patientRouter } from './modules/patient/patient.routes';
import { doctorRouter } from './modules/doctor/doctor.routes';
import { workspaceRouter } from './modules/workspace/workspace.routes';
import { notificationsRouter } from './modules/notifications/notifications.routes';
import { prisma } from './config/prisma';
import { env } from './config/env';

export const app = express();

// Security & Performance Middleware
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('short'));
}

// Global API Rate Limiter
app.use('/api', apiRateLimiter);

// Health Check Endpoint
app.get('/api/health', async (_req: Request, res: Response): Promise<void> => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'OK',
      service: 'Unified Health Platform API',
      database: 'CONNECTED',
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(503).json({
      status: 'DEGRADED',
      database: 'DISCONNECTED',
      error: err?.message,
    });
  }
});

// Public Landing Page Showcase Endpoint (Packages, Hospitals, Doctors & Demo Quick-Login Accounts)
app.get(
  '/api/public/showcase',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const [packages, workspaces, doctors, totalPatients] = await Promise.all([
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
          take: 6,
        }),
        prisma.workspace.findMany({
          where: { approvalStatus: 'APPROVED' },
          orderBy: { name: 'asc' },
          take: 8,
        }),
        prisma.doctorProfile.findMany({
          where: { approvalStatus: 'APPROVED' },
          include: {
            patientUser: {
              select: { name: true, profileAvatar: true },
            },
            workspaceAffiliations: {
              where: { status: 'ACTIVE' },
              include: {
                workspace: { select: { id: true, name: true, area: true } },
              },
            },
          },
          take: 8,
        }),
        prisma.patientUser.count(),
      ]);

      res.json({
        stats: {
          totalPatients,
          approvedHospitals: workspaces.length,
          approvedDoctors: doctors.length,
          activePackages: packages.length,
        },
        featuredPackages: packages,
        workspaces,
        doctors: doctors.map((d) => ({
          id: d.id,
          doctorIdCode: d.doctorIdCode,
          name: d.patientUser.name,
          specialty: d.specialty,
          degrees: d.degrees,
          area: d.area,
          experienceYears: d.experienceYears,
          defaultConsultationFee: d.defaultConsultationFee,
          profileImage: d.profileImage || d.patientUser.profileAvatar,
          affiliations: d.workspaceAffiliations.map((a) => ({
            workspaceName: a.workspace.name,
            area: a.workspace.area,
            fee: a.consultationFee,
          })),
        })),
        demoMode: env.DEMO_MODE,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to load public showcase' });
    }
  }
);

// Mount Domain Routers
app.use('/api/auth', authRouter);
app.use('/api/central-registry', centralRegistryRouter);
app.use('/api/patient', patientRouter);
app.use('/api/doctor', doctorRouter);
app.use('/api/workspaces', workspaceRouter);
app.use('/api/notifications', notificationsRouter);

// 404 Handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// Centralized Error Handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[API Error]', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
  });
});
