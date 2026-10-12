import { createHmac, timingSafeEqual } from 'crypto';
import { Router } from 'express';
import type { NotificationStore } from '../worker/ports';
import { HttpError } from '../http/errors';

export interface WebhookConfig {
  whatsappAppSecret?: string;
  whatsappVerifyToken?: string;
  smsWebhookToken?: string;
}

declare module 'http' {
  interface IncomingMessage {
    rawBody?: Buffer;
  }
}

export function verifySignature(secret: string, raw: Buffer, header: string | undefined): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  const given = header.slice(7);
  if (given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

interface WaStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  errors?: { title?: string; message?: string }[];
}

export function webhooksRouter(store: NotificationStore, cfg: WebhookConfig): Router {
  const r = Router();

  // Meta calls this once to confirm the endpoint is ours
  r.get('/whatsapp', (req, res) => {
    if (
      cfg.whatsappVerifyToken &&
      req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === cfg.whatsappVerifyToken
    ) {
      res.status(200).send(String(req.query['hub.challenge'] ?? ''));
      return;
    }
    res.sendStatus(403);
  });

  r.post('/whatsapp', async (req, res, next) => {
    try {
      if (!cfg.whatsappAppSecret) throw new HttpError(503, 'webhook not configured');
      const raw = req.rawBody;
      if (!raw || !verifySignature(cfg.whatsappAppSecret, raw, req.header('x-hub-signature-256'))) {
        throw new HttpError(401, 'bad signature', 'bad_signature');
      }
      const entries = (req.body?.entry ?? []) as {
        changes?: { value?: { statuses?: WaStatus[] } }[];
      }[];
      for (const entry of entries) {
        for (const change of entry.changes ?? []) {
          for (const s of change.value?.statuses ?? []) {
            if (s.status === 'sent') continue;
            await store.applyReceipt(s.id, s.status, s.errors?.[0]?.title ?? s.errors?.[0]?.message);
          }
        }
      }
      res.sendStatus(200);
    } catch (e) {
      next(e);
    }
  });

  // MSG91 delivery reports: a shared token in the query string
  r.post('/sms', async (req, res, next) => {
    try {
      if (!cfg.smsWebhookToken || req.query.token !== cfg.smsWebhookToken) {
        throw new HttpError(401, 'bad token', 'bad_token');
      }
      const items = (Array.isArray(req.body) ? req.body : [req.body]) as {
        request_id?: string;
        status?: string;
        desc?: string;
      }[];
      for (const it of items) {
        if (!it?.request_id) continue;
        const delivered = /deliver/i.test(it.status ?? '');
        await store.applyReceipt(it.request_id, delivered ? 'delivered' : 'failed', delivered ? undefined : it.desc);
      }
      res.sendStatus(200);
    } catch (e) {
      next(e);
    }
  });

  return r;
}
