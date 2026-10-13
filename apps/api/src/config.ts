import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_JWT_SECRET: z.string().min(16).optional(),
  /** https://<ref>.supabase.co/auth/v1/.well-known/jwks.json */
  SUPABASE_JWKS_URL: z.string().url().optional(),
  ML_SERVICE_URL: z.string().url().optional(),
  ML_API_KEY: z.string().optional(),
  OSRM_URL: z.string().url().default('https://router.project-osrm.org'),
  UPI_PAYEE_ID: z.string().default(''),
  UPI_PAYEE_NAME: z.string().default('ServiGo'),
  PAYOUT_ENCRYPTION_KEY: z.string().optional(),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  SMS_WEBHOOK_TOKEN: z.string().optional(),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  return parsed.data;
}
