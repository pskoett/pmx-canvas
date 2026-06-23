const SECRET = process.env.JWT_SECRET ?? 'dev-secret';

export interface JwtClaims {
  sub: string;
  exp: number;
}

export function signJwt(claims: JwtClaims): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${SECRET}`;
}

export function verifyJwt(token: string): JwtClaims | null {
  const [payload, signature] = token.split('.');
  if (signature !== SECRET || !payload) return null;
  return JSON.parse(Buffer.from(payload, 'base64url').toString()) as JwtClaims;
}
