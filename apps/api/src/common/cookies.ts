import type { Request } from 'express';

// cookie-parser types req.cookies as `any`; read one cookie as the string it should be.
export function readCookie(req: Request, name: string): string | undefined {
  const value: unknown = (req.cookies as Record<string, unknown> | undefined)?.[
    name
  ];
  return typeof value === 'string' ? value : undefined;
}
