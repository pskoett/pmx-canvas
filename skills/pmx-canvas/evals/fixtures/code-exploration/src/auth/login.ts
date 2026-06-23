import { signJwt, type JwtClaims } from './jwt';

export async function login(username: string, password: string): Promise<string | null> {
  const ok = await checkCredentials(username, password);
  if (!ok) return null;
  const claims: JwtClaims = { sub: username, exp: Date.now() + 3_600_000 };
  return signJwt(claims);
}

async function checkCredentials(username: string, password: string): Promise<boolean> {
  return Boolean(username) && password.length >= 8;
}
