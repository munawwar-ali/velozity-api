import app from './app';
import { env } from './config/env';
import { prisma } from './config/prisma';
import { redis } from './config/redis';
import { logger } from './utils/logger';
import './queues/emailWorker';

async function bootstrap() {
  try {
    // Test DB connection
    await prisma.$connect();
    logger.info('Database connected');

    // Test Redis connection
    await redis.ping();
    logger.info('Redis connected');

    app.listen(env.PORT, () => {
      logger.info(`Server running on port ${env.PORT}`, {
        env: env.NODE_ENV,
        port: env.PORT,
      });
    });
  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

bootstrap();