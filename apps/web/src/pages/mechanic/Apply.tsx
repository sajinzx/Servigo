import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { homeFor, useAuth } from '@/auth/AuthProvider';
import { AddressPicker, type PickedAddress } from '@/features/AddressPicker';
import { api } from '@/lib/api';
import { requireSupabase } from '@/lib/supabase';
import { useServices } from '@/hooks/queries';
import { Button } from '@/ui/Button';
import { SelectField, TextField } from '@/ui/Field';
import { ErrorState, Spinner } from '@/ui/Feedback';
import { Card, Chip, PageHeader } from '@/ui/Surface';

interface Application {
  id: string;
  stage: 'applied' | 'documents' | 'review' | 'approved' | 'rejected';
  shop_name: string;
  decision_reason: string | null;
  review_due_at: string | null;
}

type DocKey = 'owner_id' | 'shop_photo_outside' | 'shop_photo_bay';
const PHOTOS: { key: DocKey; label: string }[] = [
  { key: 'owner_id', label: 'Owner ID (Aadhaar, driving licence or voter ID)' },
  { key: 'shop_photo_outside', label: 'Photo of the shop from outside' },
  { key: 'shop_photo_bay', label: 'Photo of a service bay' },
];

export default function Apply() {
  const { profile, session } = useAuth();
  const existing = useQuery({
    queryKey: ['my-application'],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('workshop_applications')
        .select('id, stage, shop_name, decision_reason, review_due_at')
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw new Error(error.message);
      return (data?.[0] ?? null) as Application | null;
    },
  });

  if (profile?.role === 'mechanic') return <Navigate to={homeFor(profile)} replace />;
  if (!session) return <Navigate to="/signin" replace state={{ from: '/mechanic/apply' }} />;
  if (existing.isLoading) return <div className="container-x py-12"><Spinner /></div>;
  if (existing.isError) return <div className="container-x py-12"><ErrorState error={existing.error} /></div>;

  const app = existing.data ?? null;
  if (app && app.stage === 'review') {
    return (
      <div className="container-x max-w-2xl pb-24">
        <PageHeader eyebrow="Application" title="Under review" />
        <Card>
          <p className="text-lg">Thanks. We are checking {app.shop_name}.</p>
          <p className="mt-2 text-muted">We compare your photos with the map pin and call the number you gave. This usually takes up to 48 hours.</p>
        </Card>
      </div>
    );
  }
  if (app && app.stage === 'rejected') {
    return (
      <div className="container-x max-w-2xl pb-24">
        <PageHeader eyebrow="Application" title="Not approved" />
        <Card className="border-crit">
          <p>{app.decision_reason ?? 'Your application was not approved.'}</p>
        </Card>
      </div>
    );
  }
  return <ApplyForm existing={app} onChanged={() => void existing.refetch()} />;
}

function ApplyForm({ existing, onChanged }: { existing: Application | null; onChanged: () => void }) {
  const { profile, session } = useAuth();
  const services = useServices();
  const [appId, setAppId] = useState<string | null>(existing?.id ?? null);

  const [shop, setShop] = useState('');
  const [owner, setOwner] = useState(profile?.full_name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [staff, setStaff] = useState('2');
  const [picked, setPicked] = useState<string[]>([]);
  const [address, setAddress] = useState<PickedAddress | null>(null);

  const [files, setFiles] = useState<Partial<Record<DocKey, string>>>({});
  const [pan, setPan] = useState('');
  const [gstin, setGstin] = useState('');
  const [payout, setPayout] = useState<'upi' | 'bank'>('upi');
  const [upi, setUpi] = useState('');
  const [account, setAccount] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    guard(async () => {
      if (!address) throw new Error('Pin your workshop on the map');
      if (picked.length === 0) throw new Error('Choose at least one service you offer');
      const a = await api<Application>('/api/applications', {
        body: {
          shop_name: shop.trim(),
          owner_name: owner.trim(),
          phone: phone.startsWith('+') ? phone : `+91${phone.replace(/\D/g, '').slice(-10)}`,
          city: address.city,
          lat: address.lat,
          lng: address.lng,
          service_ids: picked,
          staff_count: Number(staff),
        },
      });
      setAppId(a.id);
    });

  const upload = (key: DocKey, file: File) =>
    guard(async () => {
      if (!appId || !session) return;
      if (file.size > 8 * 1024 * 1024) throw new Error('Please use a file under 8 MB');
      const path = `${session.user.id}/${appId}/${key}-${Date.now()}-${file.name.replace(/[^\w.-]/g, '_')}`;
      const { error } = await requireSupabase().storage.from('workshop-docs').upload(path, file); // unique path per upload, so no upsert (which needs a SELECT policy)
      if (error) throw new Error(error.message);
      await api(`/api/applications/${appId}/documents`, { body: { kind: key, storage_path: path } });
      setFiles((f) => ({ ...f, [key]: file.name }));
    });

  const submit = () =>
    guard(async () => {
      if (!appId) return;
      await api(`/api/applications/${appId}/documents`, { body: { kind: 'pan', number: pan } });
      if (gstin.trim()) await api(`/api/applications/${appId}/documents`, { body: { kind: 'gstin', number: gstin, pan } });
      if (payout === 'upi') {
        await api(`/api/applications/${appId}/documents`, { body: { kind: 'upi', upi_id: upi } });
      } else {
        await api(`/api/applications/${appId}/documents`, { body: { kind: 'bank', account_number: account, ifsc } });
      }
      await api(`/api/applications/${appId}/submit`, { body: {} });
      setDone(true);
      onChanged();
    });

  if (done) {
    return (
      <div className="container-x max-w-2xl py-16">
        <h1 className="text-5xl">Application sent</h1>
        <p className="mt-4 text-muted">We will review it within 48 hours and call you.</p>
      </div>
    );
  }

  return (
    <div className="container-x max-w-2xl pb-24">
      <PageHeader eyebrow="Join ServiGo" title={appId ? 'Documents' : 'Your workshop'} />

      {!appId ? (
        <section className="space-y-6">
          {!profile?.phone_verified ? (
            <p className="border border-warn px-4 py-3 text-sm text-warn">
              Verify your phone number first (it is part of onboarding) so we can reach you.
            </p>
          ) : null}
          <TextField label="Workshop name" value={shop} onChange={(e) => setShop(e.target.value)} />
          <TextField label="Owner name" value={owner} onChange={(e) => setOwner(e.target.value)} />
          <TextField label="Workshop phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <TextField label="Mechanics who can work at the same time" inputMode="numeric" value={staff} onChange={(e) => setStaff(e.target.value)} hint="A workshop never gets more active jobs than this." />
          <div>
            <p className="label mb-2">Services you offer</p>
            <div className="flex flex-wrap gap-2">
              {(services.data ?? []).map((s) => (
                <Chip
                  key={s.id}
                  selected={picked.includes(s.id)}
                  onClick={() => setPicked((p) => (p.includes(s.id) ? p.filter((x) => x !== s.id) : [...p, s.id]))}
                >
                  {s.name}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <p className="label mb-2">Where is the workshop?</p>
            <AddressPicker value={address} onChange={setAddress} />
          </div>
          <Button loading={busy} disabled={!profile?.phone_verified || shop.trim().length < 2} onClick={() => void create()}>
            Continue to documents
          </Button>
        </section>
      ) : (
        <section className="space-y-8">
          {PHOTOS.map((p) => (
            <div key={p.key}>
              <label className="label block" htmlFor={p.key}>{p.label}</label>
              <input
                id={p.key}
                type="file"
                accept="image/*,application/pdf"
                className="mt-2 block w-full text-sm"
                onChange={(e) => e.target.files?.[0] && void upload(p.key, e.target.files[0])}
              />
              {files[p.key] ? <p className="mt-1 text-sm text-ok">Uploaded: {files[p.key]}</p> : null}
            </div>
          ))}
          <TextField label="PAN" value={pan} onChange={(e) => setPan(e.target.value.toUpperCase())} className="mono" placeholder="ABCPE1234F" />
          <TextField label="GSTIN (if registered)" value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} className="mono" hint="Without a GSTIN, bills are issued as bills of supply with no GST." />
          <SelectField label="Where should we pay you?" value={payout} onChange={(e) => setPayout(e.target.value as 'upi' | 'bank')}>
            <option value="upi">UPI ID</option>
            <option value="bank">Bank account</option>
          </SelectField>
          {payout === 'upi' ? (
            <TextField label="UPI ID" value={upi} onChange={(e) => setUpi(e.target.value)} placeholder="name@bank" />
          ) : (
            <>
              <TextField label="Account number" inputMode="numeric" value={account} onChange={(e) => setAccount(e.target.value)} className="mono" />
              <TextField label="IFSC" value={ifsc} onChange={(e) => setIfsc(e.target.value.toUpperCase())} className="mono" />
            </>
          )}
          <p className="text-sm text-muted">Payout details are stored encrypted and only the last four characters are ever shown.</p>
          <Button loading={busy} disabled={Object.keys(files).length < 3 || !pan} onClick={() => void submit()}>
            Submit for review
          </Button>
        </section>
      )}

      {err ? <p role="alert" className="mt-6 text-sm text-crit">{err}</p> : null}
    </div>
  );
}
