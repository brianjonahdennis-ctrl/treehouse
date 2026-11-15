'use client';
import { useRef, useState } from 'react';
import { sb, SUPABASE_URL, MOCK } from '@/lib/sb';
import { Btn, toast } from './ui';

export function ImagePick({ value, onChange, folder }: { value: string; onChange: (url: string) => void; folder: 'ads' | 'covers' }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (f: File | undefined) => {
    if (!f) return;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { toast('Use a JPG, PNG or WebP picture.', true); return; }
    if (f.size > 1_500_000) { toast('Pictures must be under 1.5 MB.', true); return; }
    setBusy(true);
    try {
      const name = `${folder}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${f.type.split('/')[1].replace('jpeg', 'jpg')}`;
      if (MOCK) { onChange(URL.createObjectURL(f)); return; }
      const c = await sb();
      const { error } = await c.storage.from('ads').upload(name, f, { contentType: f.type, upsert: false, cacheControl: '31536000' });
      if (error) throw error;
      onChange(`${SUPABASE_URL}/storage/v1/object/public/ads/${name}`);
    } catch (e) {
      toast((e as Error).message || 'Upload failed.', true);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <div className="img-pick">
      {value ? <img src={value} alt="" /> : <div className="img-ph">No picture</div>}
      <div>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => pick(e.target.files?.[0])} />
        <Btn small icon="upload" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Uploading…' : value ? 'Replace' : 'Upload picture'}</Btn>
        {value && <Btn small kind="ghost" onClick={() => onChange('')}>Remove</Btn>}
        <p className="field-h">JPG, PNG or WebP, under 1.5 MB. Wide pictures (16:9) look best.</p>
      </div>
    </div>
  );
}
