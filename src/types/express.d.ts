import { Tenant, User, ApiKey } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      tenant: Tenant;
      user: User;
      apiKey: ApiKey;
    }
  }
}

export {};