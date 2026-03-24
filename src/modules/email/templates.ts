export interface EmailTemplate {
  subject: string;
  body: string;
}

export const templates = {
  USER_INVITED: (data: Record<string, string>): EmailTemplate => ({
    subject: `You've been invited to ${data.tenantName}`,
    body: `
      Hello ${data.recipientName},

      You have been invited to join ${data.tenantName} on Velozity.

      Your account has been created with the following details:
      - Email: ${data.email}
      - Role: ${data.role}

      Please contact your team owner to get your API key.

      Welcome aboard!
      The Velozity Team
    `,
  }),

  API_KEY_ROTATED: (data: Record<string, string>): EmailTemplate => ({
    subject: `API Key Rotated — ${data.tenantName}`,
    body: `
      Hello ${data.ownerName},

      Your API key for ${data.tenantName} has been rotated.

      Important: Your old API key will remain valid for 15 minutes
      to allow graceful transition. After that it will expire.

      Please update your integrations with your new API key immediately.

      If you did not perform this action, contact support immediately.

      The Velozity Team
    `,
  }),

  RATE_LIMIT_WARNING: (data: Record<string, string>): EmailTemplate => ({
    subject: `Rate Limit Warning — ${data.tenantName} at ${data.threshold}`,
    body: `
      Hello ${data.ownerName},

      Your tenant ${data.tenantName} has reached ${data.threshold} of its
      global rate limit (1000 requests/minute).

      If you continue at this rate, requests will start being rejected.

      Consider optimizing your API usage or contact us to discuss
      higher limits.

      The Velozity Team
    `,
  }),
};