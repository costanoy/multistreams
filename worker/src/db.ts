import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config, enabled } from './config.js';
import { Status, chunk } from './types.js';

const db: SupabaseClient | null = enabled.supabase
  ? createClient(config.supabase.url, config.supabase.key, { auth: { persistSession: false } })
  : null;

export async function loadChannels(): Promise<{ key: string; status: Status | null }[]> {
  if (!db) return [];
  const { data, error } = await db.from('channels').select('key,status');
  if (error) throw error;
  return data ?? [];
}

/** Canais que algum usuário logado segue: continuam sendo consultados mesmo com o app fechado (push). */
export async function followedKeys(): Promise<string[]> {
  if (!db) return [];
  const { data, error } = await db.from('follows').select('channel_key');
  if (error) throw error;
  return [...new Set((data ?? []).map(r => r.channel_key as string))];
}

export async function saveChannels(rows: { key: string; status: Status }[]): Promise<void> {
  if (!db || !rows.length) return;
  const { error } = await db.from('channels').upsert(
    rows.map(r => ({ key: r.key, live: r.status.live, status: r.status, updated_at: new Date().toISOString() })),
  );
  if (error) console.warn('[db] channels', error.message);
}

export async function removeChannels(keys: string[]): Promise<void> {
  if (!db || !keys.length) return;
  await db.from('channels').delete().in('key', keys);
}

/** Expo Notifications: avisa quem segue o canal com aviso ligado. */
export async function notifyLive(key: string, name: string, title: string, platformLabel: string, url: string): Promise<void> {
  if (!db) return;
  const { data: follows } = await db.from('follows').select('user_id,name').eq('channel_key', key).eq('notify', true);
  if (!follows?.length) return;
  const users = follows.map(f => f.user_id as string);
  const { data: muted } = await db.from('profiles').select('id').in('id', users).eq('notify_all', false);
  const off = new Set((muted ?? []).map(p => p.id));
  const { data: tokens } = await db.from('push_tokens').select('token,user_id').in('user_id', users.filter(u => !off.has(u)));
  if (!tokens?.length) return;
  const display = name || (follows[0].name as string);
  const messages = tokens.map(t => ({
    to: t.token,
    title: `${display} está ao vivo`,
    body: title ? `${title} · ${platformLabel}` : platformLabel,
    data: { url, key },
    sound: 'default',
    channelId: 'live',
  }));
  for (const part of chunk(messages, 100)) {
    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(part),
      });
      const tickets = ((await res.json()) as any).data ?? [];
      const dead = part.filter((_, i) => tickets[i]?.details?.error === 'DeviceNotRegistered').map(m => m.to);
      if (dead.length) await db.from('push_tokens').delete().in('token', dead);
    } catch (e) {
      console.warn('[push]', (e as Error).message);
    }
  }
}
