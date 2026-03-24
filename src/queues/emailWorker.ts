import { emailQueue, EmailJobData } from './emailQueue';
import { prisma } from '../config/prisma';
import { templates } from '../modules/email/templates';
import { logger } from '../utils/logger';
import nodemailer from 'nodemailer';
import { env } from '../config/env';

async function getTransporter() {
  // If SMTP credentials provided use them, otherwise use Ethereal test account
  if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) {
    return nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    });
  }

  // Auto-generate Ethereal test account
  const testAccount = await nodemailer.createTestAccount();
  logger.info('Using Ethereal test email account', {
    user: testAccount.user,
  });

  return nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
  });
}

emailQueue.process(async (job) => {
  const { type, tenantId, recipient, emailLogId, data } = job.data as EmailJobData;

  // Update attempt count
  if (emailLogId) {
    await prisma.emailLog.update({
      where: { id: emailLogId },
      data: { attemptCount: { increment: 1 } },
    });
  }

  const templateFn = templates[type];
  if (!templateFn) throw new Error(`Unknown email template: ${type}`);

  const { subject, body } = templateFn(data);
  const transporter = await getTransporter();

  const info = await transporter.sendMail({
    from: '"Velozity API" <noreply@velozity.com>',
    to: recipient,
    subject,
    text: body,
  });

  const previewUrl = nodemailer.getTestMessageUrl(info) || null;

  if (previewUrl) {
    logger.info('Email preview URL', { previewUrl, type, recipient });
  }

  // Update delivery log
  if (emailLogId) {
    await prisma.emailLog.update({
      where: { id: emailLogId },
      data: {
        status: 'SENT',
        previewUrl: previewUrl || undefined,
      },
    });
  }

  return { previewUrl };
});