import { verifyJwt } from './jwt';

export interface AuthedRequest {
  headers: Record<string, string>;
  userId?: string;
}

export function authMiddleware(req: AuthedRequest, next: () => void): void {
  const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
  const claims = verifyJwt(token);
  if (claims) req.userId = claims.sub;
  next();
}
