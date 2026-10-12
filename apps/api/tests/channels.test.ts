import { generateKeyPairSync } from 'crypto';
import { emailChannel, pushChannel, smsChannel, waNumber, whatsappChannel } from '../src/worker/channels';
import { inQuietHours, nextQuietEnd } from '../src/worker/quietHours';
import { render } from '../src/worker/templates';
import type { OutboundMessage } from '../src/worker/ports';

const msg: OutboundMessage = {
  to: { phone: '+91 98400 12345', email: 'a@example.com', pushToken: 'tok' },
  template: 'booking_accepted',
  templateVersion: 1,
  title: 'Workshop confirmed',
  body: 'body',
  vars: { ref: 'BK-1', workshop: 'Anna Nagar Auto' },
};

function fakeFetch(responses: unknown[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const body = responses.shift() ?? {};
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('channels', () => {
  it('strips a phone number to digits for WhatsApp', () => {
    expect(waNumber('+91 98400-12345')).toBe('919840012345');
  });

  it('sends a WhatsApp template message', async () => {
    const { f, calls } = fakeFetch([{ messages: [{ id: 'wamid.1' }] }]);
    const res = await whatsappChannel({ phoneNumberId: '123', accessToken: 'tkn' }, f).send(msg);
    expect(res.providerMsgId).toBe('wamid.1');
    expect(calls[0].url).toContain('/123/messages');
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.to).toBe('919840012345');
    expect(body.template.name).toBe('booking_accepted_v1');
  });

  it('refuses to send SMS for a template without a DLT id', async () => {
    const { f } = fakeFetch([]);
    await expect(smsChannel({ authKey: 'k', templateIds: {} }, f).send(msg)).rejects.toThrow(/DLT/);
  });

  it('sends SMS through the DLT template id', async () => {
    const { f, calls } = fakeFetch([{ request_id: 'r1' }]);
    const res = await smsChannel({ authKey: 'k', templateIds: { booking_accepted: 'T1' } }, f).send(msg);
    expect(res.providerMsgId).toBe('r1');
    expect(JSON.parse(calls[0].init.body as string).template_id).toBe('T1');
  });

  it('sends email via Resend', async () => {
    const { f, calls } = fakeFetch([{ id: 'em_1' }]);
    const res = await emailChannel({ apiKey: 'k', from: 'ServiGo <no-reply@servigo.app>' }, f).send(msg);
    expect(res.providerMsgId).toBe('em_1');
    expect(JSON.parse(calls[0].init.body as string).to).toEqual(['a@example.com']);
  });

  it('gets an FCM access token once and reuses it', async () => {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const { f, calls } = fakeFetch([
      { access_token: 'ya29', expires_in: 3600 },
      { name: 'projects/p/messages/1' },
      { name: 'projects/p/messages/2' },
    ]);
    const ch = pushChannel({ projectId: 'p', clientEmail: 'svc@p.iam', privateKey }, f);
    await ch.send(msg);
    await ch.send(msg);
    expect(calls.map((c) => c.url)).toEqual([
      'https://oauth2.googleapis.com/token',
      'https://fcm.googleapis.com/v1/projects/p/messages:send',
      'https://fcm.googleapis.com/v1/projects/p/messages:send',
    ]);
  });

  it('surfaces provider errors', async () => {
    const f = (async () => new Response('bad token', { status: 401 })) as unknown as typeof fetch;
    await expect(whatsappChannel({ phoneNumberId: '1', accessToken: 'x' }, f).send(msg)).rejects.toThrow(
      /whatsapp 401/,
    );
  });
});

describe('quiet hours', () => {
  it('is quiet from 21:00 to 08:00 IST', () => {
    expect(inQuietHours(new Date('2026-10-13T15:29:00Z'))).toBe(false); // 20:59 IST
    expect(inQuietHours(new Date('2026-10-13T15:30:00Z'))).toBe(true); // 21:00 IST
    expect(inQuietHours(new Date('2026-10-13T02:29:00Z'))).toBe(true); // 07:59 IST
    expect(inQuietHours(new Date('2026-10-13T02:30:00Z'))).toBe(false); // 08:00 IST
  });

  it('finds the end of the quiet period', () => {
    expect(nextQuietEnd(new Date('2026-10-13T17:30:00Z')).toISOString()).toBe('2026-10-14T02:30:00.000Z');
    expect(nextQuietEnd(new Date('2026-10-13T20:30:00Z')).toISOString()).toBe('2026-10-14T02:30:00.000Z');
    expect(nextQuietEnd(new Date('2026-10-13T00:30:00Z')).toISOString()).toBe('2026-10-13T02:30:00.000Z');
  });
});

describe('templates', () => {
  it('fills placeholders', () => {
    const r = render('booking_accepted', { workshop: 'Anna Nagar Auto', service: 'Oil change', ref: 'BK-1', eta: '20', contact: '98400' });
    expect(r.body).toBe('Anna Nagar Auto accepted your Oil change booking BK-1. ETA 20 min. Contact: 98400.');
    expect(r.version).toBe(1);
  });
});
