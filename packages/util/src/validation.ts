import { z } from 'zod';

export const Validation = {
  url: z.string().url(),
  
  email: z.string().email(),
  
  isUrl(value: string): boolean {
    return this.url.safeParse(value).success;
  },
  
  isEmail(value: string): boolean {
    return this.email.safeParse(value).success;
  },
  
  isValidJson(value: string): boolean {
    try {
      JSON.parse(value);
      return true;
    } catch {
      return false;
    }
  },
  
  hostname: z.string().regex(/^(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\-]*[A-Za-z0-9])$/),
  
  isHostname(value: string): boolean {
    return this.hostname.safeParse(value).success;
  }
};
