export type ChannelName = 'in_app' | 'push' | 'whatsapp' | 'sms' | 'email';

export interface Job {
  id: number;
  queue: 'realtime' | 'notify' | 'billing' | 'batch';
  event_type: string;
  payload: Record<string, unknown>;
  idempotency_key: string;
  attempts: number;
}

/** The durable queue. The Supabase implementation calls the SQL functions in 0005. */
export interface JobQueue {
  claim(queues: string[], limit: number, visibilitySeconds?: number): Promise<Job[]>;
  complete(id: number): Promise<void>;
  fail(id: number, error: string): Promise<void>;
  enqueue(args: {
    queue: Job['queue'];
    eventType: string;
    payload: Record<string, unknown>;
    key: string;
    runAt?: Date;
  }): Promise<void>;
}

export interface Recipient {
  userId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  whatsappOptIn: boolean;
  /** channels the user has switched off */
  disabled: ChannelName[];
  pushTokens: string[];
}

export interface BookingSummary {
  id: string;
  ref: string;
  status: string;
  customerId: string;
  workshopId: string | null;
  workshopName: string | null;
  workshopOwnerId: string | null;
  workshopPhone: string | null;
  serviceName: string;
  finalPrice: number | null;
  quoteLow: number;
  quoteHigh: number;
  etaMin: number | null;
}

export interface NotificationStore {
  /**
   * Claim the right to send this message. Returns false when the same key was
   * already sent, which is what makes a retried job safe.
   */
  reserve(rec: {
    key: string;
    userId: string;
    channel: ChannelName;
    template: string;
    templateVersion: number;
    payload: Record<string, unknown>;
  }): Promise<boolean>;
  markSent(key: string, providerMsgId?: string): Promise<void>;
  markFailed(key: string, error: string): Promise<void>;
  /** webhooks: delivery receipts from providers */
  applyReceipt(providerMsgId: string, status: 'delivered' | 'read' | 'failed', error?: string): Promise<void>;
  statusOf(key: string): Promise<string | null>;

  recipient(userId: string): Promise<Recipient | null>;
  booking(bookingId: string): Promise<BookingSummary | null>;
  pendingOfferId(bookingId: string): Promise<string | null>;
  isOfferPending(offerId: string): Promise<boolean>;
}

export interface OutboundMessage {
  to: { phone?: string | null; email?: string | null; pushToken?: string };
  template: string;
  templateVersion: number;
  title: string;
  body: string;
  vars: Record<string, string>;
}

export interface Channel {
  name: ChannelName;
  send(msg: OutboundMessage): Promise<{ providerMsgId?: string }>;
}
