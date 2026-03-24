import 'express-async-errors';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { errorHandler } from './middleware/errorHandler';
import { recordResponseTime } from './modules/health/health.routes';

import authRoutes from './modules/auth/auth.routes';
import userRoutes from './modules/users/users.routes';
import auditRoutes from './modules/audit/audit.routes';
import healthRoutes from './modules/health/health.routes';
import metricsRoutes from './modules/metrics/metrics.routes';
import tenantRoutes from './modules/tenants/tenants.routes';

const app = express();

// Security middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Response time tracking
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    recordResponseTime(Date.now() - start);
  });
  next();
});

// Routes
app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/audit', auditRoutes);
app.use('/tenants', tenantRoutes);
app.use('/health', healthRoutes);
app.use('/metrics', metricsRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
      details: null,
    },
  });
});

// Global error handler
app.use(errorHandler);

export default app;