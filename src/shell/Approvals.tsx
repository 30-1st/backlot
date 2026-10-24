import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { campaignTitle } from './Notifications';
import { LABELS } from './Brand';
import type { ScreenProps } from './Shell';

// The approvals log: every decision on a client's work, newest first, as a record of who
// said yes to what and when. Only the server writes it; nobody can edit a line.

type Line = {
  id: number;
  kind: 'post' | 'voice' | 'brand' | 'campaign';
  decision: string;
  campaignId: string | null;
  slot: number | null;
  subject: string | null;
  note: string | null;
  actorId: string | null;
  actorRole: 'team' | 'client';
  at: string;
};

const WORDS: Record<string, string> = {
  approved: 'Approved',
  changes: 'Asked for changes',
  posted: 'Marked as posted',
  undone: 'Undid a decision',
  saved: 'Saved',
  suggested: 'Suggested changes',
  dropped: 'Dropped suggested changes',
  discarded: 'Discarded',
  restored: 'Restored',
};

const PAGE = 100;

/** "niche, allowedHashtags" -> "Niche, Hashtags". */
const fields = (s: string) =>
  s
    .split(',')
    .map((k) => (LABELS as Record<string, string>)[k.trim()] ?? k.trim())
    .join(', ');

export function ApprovalsScreen({ me, ws, single, isTeam, go }: ScreenProps) {
  const client = ws.data?.clients.find((c) => c.id === single) ?? null;
  const [lines, setLines] = useState<Line[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');

  async function load(before?: number) {
    if (!supabase || !client) return;
    let q = supabase
      .from('approval_log')
      .select('id, kind, decision, campaign_id, slot, subject, note, actor_id, actor_role, created_at')
      .eq('client_id', client.id)
      .order('id', { ascending: false })
      .limit(PAGE);
    if (before) q = q.lt('id', before);
    const { data, error: e } = await q;
    if (e) return setError(e.message);
    const rows: Line[] = (data ?? []).map((r) => ({
      id: Number(r.id),
      kind: r.kind,
      decision: String(r.decision),
      campaignId: r.campaign_id ?? null,
      slot: r.slot ?? null,
      subject: r.subject ?? null,
      note: r.note ?? null,
      actorId: r.actor_id ?? null,
      actorRole: r.actor_role === 'client' ? 'client' : 'team',
      at: String(r.created_at),
    }));
    setLines((prev) => (before ? [...(prev ?? []), ...rows] : rows));
    setMore(rows.length === PAGE);
    setError('');
  }

  useEffect(() => {
    setLines(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client?.id]);

  if (!client) {
    return (
      <main className="bl-flow">
        <h1 className="bl-h1 bl-rise">Approvals</h1>
        <p className="bl-p bl-muted">Pick a client first.</p>
      </main>
    );
  }

  const who = (l: Line) => (l.actorId && l.actorId === me.userId ? 'You' : l.actorRole === 'client' ? `@${client.handle}` : 'Your team');
  const what = (l: Line) => {
    if (l.kind === 'voice') return 'Voice card';
    if (l.kind === 'brand') return 'Brand kit';
    if (l.kind === 'campaign') return `Campaign${l.subject ? `, ${l.subject}` : ''}`;
    const c = l.campaignId ? ws.data?.campaigns.find((x) => x.id === l.campaignId) : null;
    return `Post ${l.slot ?? ''}${c ? `, ${campaignTitle(c)}` : ''}`;
  };
  const dayOf = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const groups: Array<[string, Line[]]> = [];
  for (const l of lines ?? []) {
    const d = dayOf(l.at);
    const last = groups[groups.length - 1];
    if (last && last[0] === d) last[1].push(l);
    else groups.push([d, [l]]);
  }

  return (
    <main className="bl-flow">
      <div>
        <h1 className="bl-h1 bl-rise">Approvals</h1>
        <p className="bl-small" style={{ margin: '6px 0 0' }}>
          {isTeam ? `@${client.handle}. ` : ''}Every yes, change and posted mark on {isTeam ? 'this client’s' : 'your'} work, newest first. Lines can&rsquo;t be edited.
        </p>
      </div>
      {error && (
        <p className="bl-error" role="alert">
          {error}
        </p>
      )}
      {lines === null && !error && (
        <p className="bl-small" aria-busy="true">
          Loading the log.
        </p>
      )}
      {lines?.length === 0 && (
        <div className="bl-glass-card">
          <b>Nothing yet</b>
          <p className="bl-p bl-muted" style={{ margin: 0 }}>
            Decisions show up here as soon as someone approves a post, the voice card or the brand kit.
          </p>
        </div>
      )}
      {groups.map(([d, list]) => (
        <section key={d} className="bl-log-day" aria-label={d}>
          <h2 className="bl-label">{d}</h2>
          <ol className="bl-log">
            {list.map((l) => (
              <li key={l.id} className="bl-log-line">
                <div className="bl-log-top">
                  <b>{WORDS[l.decision] ?? l.decision}</b>
                  <span className="bl-small num">{new Date(l.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
                </div>
                <span className="bl-small">
                  {what(l)} · {who(l)}
                </span>
                {l.subject && <span className="bl-log-subject">{l.kind === 'brand' ? `Changed: ${fields(l.subject)}` : l.subject}</span>}
                {l.note && <span className="bl-small">&ldquo;{l.note}&rdquo;</span>}
                {l.kind === 'post' && l.campaignId && ws.data?.campaigns.some((c) => c.id === l.campaignId) && (
                  <button type="button" className="bl-linkish" style={{ alignSelf: 'flex-start' }} onClick={() => go(`campaigns.${l.campaignId}`)}>
                    Open the campaign
                  </button>
                )}
              </li>
            ))}
          </ol>
        </section>
      ))}
      {more && (
        <button type="button" className="bl-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => void load(lines?.[lines.length - 1]?.id)}>
          Show older
        </button>
      )}
    </main>
  );
}
