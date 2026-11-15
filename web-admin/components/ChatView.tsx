'use client';
import { useEffect, useState } from 'react';
import { sb } from '@/lib/sb';
import { date } from '@/lib/fmt';
import { Icon } from './Icon';

export type ChatMsg = { id: number; sender: string | null; body: string | null; photo: string | null; created_at: string; edited_at?: string | null; deleted_at?: string | null; from_reported?: boolean };
export type Unsent = { sender: string | null; body: string; sent_at: string; unsent_at: string };

function Photo({ path }: { path: string }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    sb().then((c) => c.storage.from('chat-photos').createSignedUrl(path, 300))
      .then(({ data, error }) => { if (!live) return; if (error || !data) setFailed(true); else setUrl(data.signedUrl); })
      .catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [path]);
  if (failed) return <span className="photo-gone"><Icon name="image" size={16} />Photo expired or removed</span>;
  if (!url) return <span className="photo-gone"><Icon name="image" size={16} />Loading photo…</span>;
  return <a href={url} target="_blank" rel="noreferrer noopener"><img className="chat-photo" src={url} alt="Photo sent in the chat" /></a>;
}

export function ChatView({ messages, people, unsent = [], highlight }: { messages: ChatMsg[]; people: (string | null)[]; unsent?: Unsent[]; highlight?: string | null }) {
  if (!messages.length) return <p className="muted pad">No messages in this chat.</p>;
  return (
    <div className="chat">
      {messages.map((m) => {
        const right = m.sender && people[1] && m.sender === people[1];
        return (
          <div key={m.id} className={`bub-row ${right ? 'r' : ''}`}>
            <div className={`bub ${highlight && m.sender === highlight ? 'flag' : ''} ${m.deleted_at ? 'del' : ''}`}>
              <span className="bub-who">{m.sender || 'deleted account'}</span>
              {m.photo && <Photo path={m.photo} />}
              {m.body && <p>{m.body}</p>}
              <span className="bub-t">{date(m.created_at)}{m.edited_at ? ' · edited' : ''}{m.deleted_at ? ' · deleted' : ''}</span>
            </div>
          </div>
        );
      })}
      {unsent.length > 0 && (
        <div className="unsent">
          <h4><Icon name="eye" size={15} />Unsent by the sender ({unsent.length})</h4>
          {unsent.map((u, i) => <p key={i}><b>{u.sender || '—'}</b> {u.body} <span className="muted">· sent {date(u.sent_at)}, unsent {date(u.unsent_at)}</span></p>)}
        </div>
      )}
    </div>
  );
}
