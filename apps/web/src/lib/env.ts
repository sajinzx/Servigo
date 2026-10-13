export const env = {
  apiUrl: (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000',
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL as string | undefined,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined,
  /** drop your own QR image into public/ to use it instead of the generated one */
  upiQrPath: '/upi-qr.png',
};

export const isConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey);
