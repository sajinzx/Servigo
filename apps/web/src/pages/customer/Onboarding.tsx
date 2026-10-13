import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { api } from '@/lib/api';
import { normalisePlate } from '@/lib/format';
import { requireSupabase } from '@/lib/supabase';
import { useVehicleModels } from '@/hooks/queries';
import { AddressPicker, type PickedAddress } from '@/features/AddressPicker';
import { normalisePhone } from '@/pages/SignIn';
import { Button } from '@/ui/Button';
import { SelectField, TextField } from '@/ui/Field';

const STEPS = ['You', 'Address', 'Vehicle'] as const;
const PLATE = /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$/;

/** Three steps, once: confirm name and phone, add a place, add the first vehicle. */
export default function Onboarding() {
  const { profile, session, startPhoneLink, confirmPhoneLink, refreshProfile } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const models = useVehicleModels();

  const [step, setStep] = useState(0);
  const [name, setName] = useState(profile?.full_name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [whatsapp, setWhatsapp] = useState(true);
  const [address, setAddress] = useState<PickedAddress | null>(null);
  const [modelId, setModelId] = useState('');
  const [plate, setPlate] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear() - 3));
  const [odometer, setOdometer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const e164 = normalisePhone(phone);

  const stepOne = () =>
    guard(async () => {
      if (name.trim().length < 2) throw new Error('Please enter your name');
      if (!e164) throw new Error('Enter a 10 digit Indian mobile number');
      if (!profile?.phone_verified || profile.phone !== e164) {
        // linked to the account that is already signed in; signing in with the phone
        // would create a second account for the same person
        if (!sent) {
          await startPhoneLink(e164);
          setSent(true);
          return;
        }
        await confirmPhoneLink(e164, code.trim());
      }
      await api('/api/me', { method: 'PATCH', body: { full_name: name.trim(), whatsapp_opt_in: whatsapp } });
      await refreshProfile();
      setStep(1);
    });

  const stepTwo = () =>
    guard(async () => {
      if (!address) throw new Error('Search for your address and pick one of the results');
      const { error: err } = await requireSupabase().from('addresses').insert({
        user_id: session!.user.id,
        label: 'home',
        line1: address.line1,
        city: address.city,
        pincode: address.pincode,
        lat: address.lat,
        lng: address.lng,
        is_default: true,
      });
      if (err) throw new Error(err.message);
      setStep(2);
    });

  const stepThree = () =>
    guard(async () => {
      const reg = normalisePlate(plate);
      if (!PLATE.test(reg)) throw new Error('Enter the registration number, for example TN09AB1234');
      if (!modelId) throw new Error('Choose your vehicle');
      const { error: err } = await requireSupabase()
        .from('vehicles')
        .insert({
          owner_id: session!.user.id,
          registration_no: reg,
          model_id: modelId,
          year: Number(year),
          odometer_km: Number(odometer) || 0,
        });
      if (err) throw new Error(err.message.includes('duplicate') ? 'That registration number is already registered' : err.message);
      // the database stamps onboarded_at once name, verified phone, address and vehicle all exist
      const { error: e2 } = await requireSupabase().rpc('complete_onboarding');
      if (e2) throw new Error(e2.message);
      await refreshProfile();
      await qc.invalidateQueries();
      nav('/garage', { replace: true });
    });

  return (
    <div className="container-x max-w-xl py-14">
      <ol className="mb-10 flex gap-6" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? 'step' : undefined} className={i <= step ? 'text-ink' : 'text-muted'}>
            <span className="label">{`0${i + 1}`}</span>
            <span className="ml-2">{s}</span>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <section className="space-y-6">
          <h1 className="text-4xl">Let&apos;s get you set up</h1>
          <TextField label="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          <TextField
            label="Mobile number"
            inputMode="tel"
            value={phone}
            disabled={sent}
            onChange={(e) => setPhone(e.target.value)}
            hint="We verify it with a code, even if you signed in with Google. Workshops call this number."
          />
          {sent ? (
            <TextField label="6 digit code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
          ) : null}
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1" checked={whatsapp} onChange={(e) => setWhatsapp(e.target.checked)} />
            <span>Send booking updates and invoices on WhatsApp. You can turn this off any time.</span>
          </label>
          <Button loading={busy} onClick={() => void stepOne()}>
            {sent ? 'Verify and continue' : profile?.phone_verified && profile.phone === e164 ? 'Continue' : 'Send code'}
          </Button>
        </section>
      )}

      {step === 1 && (
        <section className="space-y-6">
          <h1 className="text-4xl">Where do you want service?</h1>
          <p className="text-muted">We only use your location when you book, to find workshops near you.</p>
          <AddressPicker value={address} onChange={setAddress} />
          <Button loading={busy} onClick={() => void stepTwo()}>
            Continue
          </Button>
        </section>
      )}

      {step === 2 && (
        <section className="space-y-6">
          <h1 className="text-4xl">Add your vehicle</h1>
          <SelectField label="Make and model" value={modelId} onChange={(e) => setModelId(e.target.value)}>
            <option value="">Choose…</option>
            {(models.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.make} {m.model} ({m.kind})
              </option>
            ))}
          </SelectField>
          <TextField
            label="Registration number"
            value={plate}
            onChange={(e) => setPlate(e.target.value.toUpperCase())}
            placeholder="TN09AB1234"
            className="mono"
          />
          <div className="grid grid-cols-2 gap-4">
            <TextField label="Year" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} />
            <TextField label="Odometer (km)" inputMode="numeric" value={odometer} onChange={(e) => setOdometer(e.target.value)} />
          </div>
          <Button loading={busy} onClick={() => void stepThree()}>
            Finish
          </Button>
        </section>
      )}

      {error ? (
        <p role="alert" className="mt-6 text-sm text-crit">
          {error}
        </p>
      ) : null}
    </div>
  );
}
