import request from 'supertest';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';

describe('health', () => {
  it('responds ok', async () => {
    const app = createApp(loadConfig({ NODE_ENV: 'test' }));
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('treats empty env values as unset', () => {
    const c = loadConfig({ NODE_ENV: 'test', SUPABASE_JWT_SECRET: '', ML_SERVICE_URL: '', RAZORPAY_KEY_ID: '' });
    expect(c.SUPABASE_JWT_SECRET).toBeUndefined();
    expect(c.ML_SERVICE_URL).toBeUndefined();
  });
});
