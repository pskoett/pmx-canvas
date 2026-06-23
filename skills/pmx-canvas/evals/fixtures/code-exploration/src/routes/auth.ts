import { login } from '../auth/login';
import { authMiddleware, type AuthedRequest } from '../auth/middleware';

export function registerAuthRoutes(router: {
  post(path: string, handler: (req: AuthedRequest) => Promise<unknown>): void;
  use(handler: (req: AuthedRequest, next: () => void) => void): void;
}): void {
  router.use(authMiddleware);
  router.post('/login', async (req) => {
    const token = await login(req.headers.username ?? '', req.headers.password ?? '');
    return token ? { token } : { error: 'invalid credentials' };
  });
}
