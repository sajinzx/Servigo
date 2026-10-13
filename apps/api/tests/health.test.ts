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
});
