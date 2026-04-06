import type { Request, Response } from 'express';
import { getIronSession } from 'iron-session';

export interface SessionData {
  accessToken?: string;
  user?: {
    id: string;
    provider: string;
    providerId: string;
    name: string;
    initials: string;
    avatarUrl?: string;
  };
}

const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me-in-production-at-least-32-chars';

export const sessionOptions = {
  password: SESSION_SECRET,
  cookieName: 'moou_session',
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 24 * 14, // 14 days in seconds
  },
};

export async function getSession(req: Request, res: Response) {
  return getIronSession<SessionData>(req, res, sessionOptions);
}
