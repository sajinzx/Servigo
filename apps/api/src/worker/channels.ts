import jwt from 'jsonwebtoken';
import type { Channel, OutboundMessage } from './ports';

type Fetch = typeof fetch;

async function post(f: Fetch, url: string, init: RequestInit, label: string): Promise<unknown> {
  const res = await f(url, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${label} ${res.status}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** digits only, with country code, as the WhatsApp Cloud API expects */
export const waNumber = (phone: string) => phone.replace(/\D/g, '');

export interface WhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
  apiVersion?: string;
  /** language code the templates were approved in */
  language?: string;
}

/** Business-initiated messages must be pre-approved templates; the body is built from `vars`. */
export function whatsappChannel(cfg: WhatsAppConfig, f: Fetch = fetch): Channel {
  return {
    name: 'whatsapp',
    async send(msg: OutboundMessage) {
      if (!msg.to.phone) throw new Error('no phone number');
      const body = {
        messaging_product: 'whatsapp',
        to: waNumber(msg.to.phone),
        type: 'template',
        template: {
          name: `${msg.template}_v${msg.templateVersion}`,
          language: { code: cfg.language ?? 'en' },
          components: [
            {
              type: 'body',
              parameters: Object.values(msg.vars).map((v) => ({ type: 'text', text: v || '-' })),
            },
          ],
        },
      };
      const res = (await post(
        f,
        `https://graph.facebook.com/${cfg.apiVersion ?? 'v20.0'}/${cfg.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        'whatsapp',
      )) as { messages?: { id: string }[] };
      return { providerMsgId: res.messages?.[0]?.id };
    },
  };
}

export interface Msg91Config {
  authKey: string;
  /** DLT-registered template ids by our template name */
  templateIds: Record<string, string>;
}

export function smsChannel(cfg: Msg91Config, f: Fetch = fetch): Channel {
  return {
    name: 'sms',
    async send(msg) {
      if (!msg.to.phone) throw new Error('no phone number');
      const templateId = cfg.templateIds[msg.template];
      if (!templateId) throw new Error(`template ${msg.template} is not DLT registered`);
      const res = (await post(
        f,
        'https://control.msg91.com/api/v5/flow/',
        {
          method: 'POST',
          headers: { authkey: cfg.authKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            template_id: templateId,
            recipients: [{ mobiles: waNumber(msg.to.phone), ...msg.vars }],
          }),
        },
        'sms',
      )) as { request_id?: string; message?: string };
      return { providerMsgId: res.request_id ?? res.message };
    },
  };
}

export interface ResendConfig {
  apiKey: string;
  from: string;
}

export function emailChannel(cfg: ResendConfig, f: Fetch = fetch): Channel {
  return {
    name: 'email',
    async send(msg) {
      if (!msg.to.email) throw new Error('no email address');
      const res = (await post(
        f,
        'https://api.resend.com/emails',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: cfg.from,
            to: [msg.to.email],
            subject: msg.title,
            text: msg.body,
          }),
        },
        'email',
      )) as { id?: string };
      return { providerMsgId: res.id };
    },
  };
}

export interface FcmConfig {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

/** FCM HTTP v1: exchange a signed service-account JWT for an access token, then send. */
export function pushChannel(cfg: FcmConfig, f: Fetch = fetch): Channel {
  let cached: { token: string; exp: number } | null = null;

  async function accessToken(): Promise<string> {
    const nowS = Math.floor(Date.now() / 1000);
    if (cached && cached.exp - 60 > nowS) return cached.token;
    const assertion = jwt.sign(
      {
        iss: cfg.clientEmail,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
      },
      cfg.privateKey.replace(/\\n/g, '\n'),
      { algorithm: 'RS256', expiresIn: 3600 },
    );
    const res = (await post(
      f,
      'https://oauth2.googleapis.com/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }).toString(),
      },
      'fcm-auth',
    )) as { access_token: string; expires_in: number };
    cached = { token: res.access_token, exp: nowS + res.expires_in };
    return cached.token;
  }

  return {
    name: 'push',
    async send(msg) {
      if (!msg.to.pushToken) throw new Error('no device token');
      const res = (await post(
        f,
        `https://fcm.googleapis.com/v1/projects/${cfg.projectId}/messages:send`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${await accessToken()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              token: msg.to.pushToken,
              notification: { title: msg.title, body: msg.body },
              data: { template: msg.template, ...msg.vars },
            },
          }),
        },
        'fcm',
      )) as { name?: string };
      return { providerMsgId: res.name };
    },
  };
}
