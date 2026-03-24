import { Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { ApiError } from './errorHandler';

export function requireOwner(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (req.user.role !== Role.OWNER) {
    throw new ApiError(
      403,
      'FORBIDDEN',
      'This action requires Owner role'
    );
  }
  next();
}

export function requireMember(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required');
  }
  next();
}