import Bull from 'bull';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export interface EmailJobData {
  type: 'USER_INVITED' | 'API_KEY_ROTATED' | 'RATE_LIMIT_WARNING';
  tenantId: string;
  recipient: string;
  emailLogId?: string;
  data: Record<string, string>;
}

export const emailQueue = new Bull<EmailJobData>('email', {
  redis: env.REDIS_URL,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000, // 2s, 4s, 8s
    },
    removeOnComplete: 100,
    removeOnFail: false, // Keep failed jobs in DLQ
  },
});

export async function addEmailJob(jobData: EmailJobData): Promise<void> {
  await emailQueue.add(jobData, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  });
  logger.info('Email job queued', { type: jobData.type, recipient: jobData.recipient });
}

// Dead Letter Queue — failed jobs handler
emailQueue.on('failed', (job, err) => {
  logger.error('Email job permanently failed', {
    jobId: job.id,
    type: job.data.type,
    recipient: job.data.recipient,
    error: err.message,
    attempts: job.attemptsMade,
  });
});

emailQueue.on('completed', (job) => {
  logger.info('Email job completed', {
    jobId: job.id,
    type: job.data.type,
    recipient: job.data.recipient,
  });
});