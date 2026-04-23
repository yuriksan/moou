import type { Request, Response, NextFunction } from 'express';

type Role = 'admin' | 'modifier' | 'viewer';

export const requireRole = (...allowed: Role[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.role) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
      return;
    }
    if (!allowed.includes(req.user.role as Role)) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return;
    }
    next();
  };

/** Allows admin and modifier — blocks viewer. */
export const requireWrite = requireRole('admin', 'modifier');

/** Allows admin only. */
export const requireAdmin = requireRole('admin');
