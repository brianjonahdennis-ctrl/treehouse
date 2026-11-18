'use client';
import { useRef, useState } from 'react';
import { sb, SUPABASE_URL, MOCK } from '@/lib/sb';
import { Btn, toast } from './ui';
import { shrinkImage } from '@/lib/shrinkImage';

export function ImagePick({ value, onChange, folder }: { value: string; onChange: (url: string) => void; folder: 'ads' | 'covers' }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (picked: File | undefined) => {
    if (!picked) return;
    if (!/^image\/(jpeg|png|webp)$/.test(picked.type)) { toast('Use a JPG, PNG or WebP picture.', true); return; }
    const f = await shrinkImage(picked);   // members download this picture: keep it small
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

// Treasure Hunt prizes: a picture (shrunk like ad pictures) or a short video, into the "hunt-prizes"
// bucket (Admins only; the bucket itself refuses files over 20 MB).
export const PRIZE_VIDEO_MAX = 20 * 1024 * 1024;
export function MediaPick({ onUploaded }: { onUploaded: (m: { url: string; type: 'image' | 'video' }) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (picked: File | undefined) => {
    if (!picked) return;
    const video = /^video\/(mp4|webm|quicktime)$/.test(picked.type);
    if (!video && !/^image\/(jpeg|png|webp)$/.test(picked.type)) { toast('Use a JPG, PNG or WebP picture, or an MP4, WebM or MOV video.', true); return; }
    if (video && picked.size > PRIZE_VIDEO_MAX) { toast(`Videos must be under 20 MB (this one is ${(picked.size / 1048576).toFixed(1)} MB). Trim it or lower the quality.`, true); return; }
    setBusy(true);
    try {
      const f = video ? picked : await shrinkImage(picked);
      if (!video && f.size > 1_500_000) { toast('Pictures must be under 1.5 MB.', true); return; }
      const ext = video ? ({ 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' } as Record<string, string>)[f.type] : f.type.split('/')[1].replace('jpeg', 'jpg');
      const name = `prizes/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      if (MOCK) { onUploaded({ url: URL.createObjectURL(f), type: video ? 'video' : 'image' }); return; }
      const c = await sb();
      const { error } = await c.storage.from('hunt-prizes').upload(name, f, { contentType: f.type, upsert: false, cacheControl: '31536000' });
      if (error) throw error;
      onUploaded({ url: `${SUPABASE_URL}/storage/v1/object/public/hunt-prizes/${name}`, type: video ? 'video' : 'image' });
    } catch (e) {
      toast((e as Error).message || 'Upload failed.', true);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" hidden onChange={(e) => pick(e.target.files?.[0])} />
      <Btn small icon="upload" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Uploading…' : 'Add picture or video'}</Btn>
    </>
  );
}
