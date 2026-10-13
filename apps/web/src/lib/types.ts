import type { BookingStatus } from './status';

export interface VehicleModel {
  id: string;
  kind: 'car' | 'bike';
  make: string;
  model: string;
  fuel: string;
  segment: string;
}

export interface Vehicle {
  id: string;
  registration_no: string;
  year: number;
  odometer_km: number;
  last_service_at: string | null;
  vehicle_models: VehicleModel;
}

export interface Service {
  id: string;
  code: string;
  name: string;
  vehicle_kind: 'car' | 'bike';
  category: string;
  base_price: number;
  base_duration_min: number;
}

export interface Address {
  id: string;
  label: string;
  line1: string;
  city: string;
  pincode: string | null;
  lat: number;
  lng: number;
  is_default: boolean;
}

export interface Booking {
  id: string;
  ref: string;
  status: BookingStatus;
  mode: 'workshop' | 'doorstep';
  customer_id: string;
  workshop_id: string | null;
  pickup_lat: number;
  pickup_lng: number;
  quote_low: number;
  quote_high: number;
  final_price: number | null;
  needs_price_approval: boolean;
  price_approved_at: string | null;
  predicted_duration_min: number | null;
  eta_min: number | null;
  distance_km: number | null;
  symptom_text: string | null;
  labour_amount: number | null;
  parts_amount: number | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  scheduled_for: string | null;
  services?: { name: string; code: string; vehicle_kind: 'car' | 'bike' } | null;
  vehicles?: { registration_no: string; vehicle_models: { make: string; model: string } } | null;
  workshops?: { name: string; phone: string | null; lat: number; lng: number } | null;
}

export interface BookingEvent {
  id: number;
  to_status: BookingStatus;
  at: string;
}

export interface Offer {
  id: string;
  booking_id: string;
  workshop_id: string;
  score: number;
  rank: number;
  offered_at: string;
  expires_at: string;
  response: 'pending' | 'accepted' | 'rejected' | 'expired';
  bookings?: Booking | null;
}

export interface Payment {
  id: string;
  booking_id: string;
  amount: number;
  method: 'upi_link' | 'upi_qr' | 'razorpay';
  status: 'initiated' | 'pending_verification' | 'confirmed' | 'failed' | 'refunded';
  reference: string;
  utr: string | null;
  submitted_at: string | null;
}

export interface Invoice {
  id: string;
  invoice_no: string;
  series: 'INV' | 'BOS' | 'CN' | 'CI';
  total: number;
  issued_at: string;
  pdf_path: string | null;
  booking_id: string | null;
}

export interface Workshop {
  id: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
  staff_count: number;
  stage: 'applied' | 'review' | 'probation' | 'active' | 'suspended';
  rating_sum: number;
  rating_count: number;
}

export interface PayResponse {
  payment: Payment;
  amount: number;
  reference: string;
  upi_link?: string;
  static_qr?: string;
  dynamic_qr?: string;
  instructions?: string;
  order?: { id: string; amount: number; currency: string; key_id: string };
}

export interface QuoteResponse {
  price: { low: number; high: number; expected: number; gst_inclusive: boolean };
  duration: { minutes: number; low: number; high: number };
  source: { price: 'baseline' | 'ml'; duration: 'baseline' | 'ml' };
  why: { feature: string; effect: number }[];
}

export interface TriageSuggestion {
  code: string;
  name: string;
  probability: number;
}
