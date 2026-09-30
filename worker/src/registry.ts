import { config, enabled } from './config.js';
import * as db from './db.js';
import * as kick from './kick.js';
import * as twitch from './twitch.js';
import { Live, Platform, PLATFORMS, Status } from './types.js';
import * as youtube from './youtube.js';

/**
 * Registro de canais acompanhados. O polling é por canal, não por usuário:
 * mil pessoas seguindo o mesmo streamer geram uma consulta só.
 */
interface Tracked {
  platform: Platform;
  channelId: string;
  status: Status | null;
  /** última vez que algum app pediu este canal (ou que ele apareceu em follows) */
  wantedAt: number;
}

const tracked = new Map<string, Tracked>();
const KEEP_MS = 14 * 24 * 3600e3;
const LABEL: Record<Platform, string> = { twitch: 'Twitch', youtube: 'YouTube', kick: 'Kick' };

export const parseKey = (key: string): { platform: Platform; channelId: string } | null => {
  const i = key.indexOf(':');
  const platform = key.slice(0, i) as Platform;
  const channelId = key.slice(i + 1);
  return PLATFORMS.includes(platform) && channelId && channelId.length < 80 ? { platform, channelId } : null;
};

const ofPlatform = (p: Platform, keys?: string[]) =>
  (keys ?? [...tracked.keys()]).filter(k => tracked.get(k)?.platform === p);

function apply(key: string, live: Live | undefined, endedAt?: string | null): { key: string; status: Status } | null {
  const t = tracked.get(key);
  if (!t) return null;
  const prev = t.status;
  const now = new Date().toISOString();
  let lastLiveAt = prev?.lastLiveAt ?? null;
  if (endedAt && endedAt > (lastLiveAt ?? '')) lastLiveAt = endedAt;
  if (prev?.live && !live) lastLiveAt = now;
  t.status = live
    ? { live: true, viewers: live.viewers, title: live.title, cat: live.cat, thumb: live.thumb, lang: live.lang, startedAt: live.startedAt, lastLiveAt, url: live.url, checkedAt: now }
    : { live: false, viewers: 0, title: '', cat: '', thumb: null, lang: prev?.lang ?? null, startedAt: null, lastLiveAt, url: null, checkedAt: now };
  // só avisa em transição offline → ao vivo já observada (não na primeira consulta)
  if (live && prev && !prev.live) {
    void db.notifyLive(key, live.name ?? '', live.title, LABEL[t.platform], live.url);
  }
  const changed = !prev || prev.live !== t.status.live || prev.lastLiveAt !== t.status.lastLiveAt;
  return changed || live ? { key, status: t.status } : null;
}

export async function poll(platform: Platform, keys?: string[]): Promise<void> {
  if (!enabled[platform]) return;
  const list = ofPlatform(platform, keys);
  if (!list.length) return;
  const ids = list.map(k => tracked.get(k)!.channelId);
  const dirty: { key: string; status: Status }[] = [];
  const push = (r: ReturnType<typeof apply>) => r && dirty.push(r);

  if (platform === 'youtube') {
    const r = await youtube.fetchLive(ids);
    for (const k of list) {
      const id = tracked.get(k)!.channelId;
      if (r.unknown.has(id) && tracked.get(k)!.status) continue;
      push(apply(k, r.live.get(id), r.ended.get(id)));
    }
  } else {
    const live = await (platform === 'twitch' ? twitch : kick).fetchLive(ids);
    for (const k of list) {
      const t = tracked.get(k)!;
      let ended: string | null = null;
      if (platform === 'twitch' && !t.status && !live.has(t.channelId)) ended = await twitch.lastLiveAt(t.channelId);
      push(apply(k, live.get(t.channelId), ended));
    }
  }
  await db.saveChannels(dirty);
}

/** Devolve o status dos canais pedidos; os desconhecidos entram no registro e são consultados na hora. */
export async function statusFor(keys: string[]): Promise<Record<string, Status>> {
  const now = Date.now();
  const fresh: string[] = [];
  for (const key of keys) {
    const t = tracked.get(key);
    if (t) {
      t.wantedAt = now;
      continue;
    }
    const p = parseKey(key);
    if (!p || !enabled[p.platform]) continue;
    tracked.set(key, { ...p, status: null, wantedAt: now });
    fresh.push(key);
    if (p.platform === 'twitch' && enabled.eventsub) void twitch.subscribeOnline(p.channelId);
  }
  if (fresh.length) {
    await Promise.all(PLATFORMS.map(p => poll(p, fresh).catch(e => console.warn(`[${p}] primeira consulta:`, e.message))));
  }
  const out: Record<string, Status> = {};
  for (const key of keys) {
    const s = tracked.get(key)?.status;
    if (s) out[key] = s;
  }
  return out;
}

async function refreshWanted(): Promise<void> {
  try {
    const now = Date.now();
    for (const key of await db.followedKeys()) {
      const t = tracked.get(key);
      if (t) t.wantedAt = now;
      else {
        const p = parseKey(key);
        if (p) tracked.set(key, { ...p, status: null, wantedAt: now });
      }
    }
  } catch (e) {
    console.warn('[db] follows', (e as Error).message);
  }
  const stale = [...tracked].filter(([, t]) => Date.now() - t.wantedAt > KEEP_MS).map(([k]) => k);
  stale.forEach(k => tracked.delete(k));
  await db.removeChannels(stale);
}

export async function start(): Promise<void> {
  try {
    for (const row of await db.loadChannels()) {
      const p = parseKey(row.key);
      if (p) tracked.set(row.key, { ...p, status: row.status, wantedAt: Date.now() });
    }
  } catch (e) {
    console.warn('[db] não foi possível carregar os canais:', (e as Error).message);
  }
  await refreshWanted();
  setInterval(refreshWanted, 3600e3);
  for (const p of PLATFORMS) {
    if (!enabled[p]) continue;
    const run = () => poll(p).catch(e => console.warn(`[${p}] polling:`, e.message));
    void run();
    setInterval(run, config.poll[p]);
  }
  if (enabled.eventsub) for (const k of ofPlatform('twitch')) void twitch.subscribeOnline(tracked.get(k)!.channelId);
  console.log(`[registry] ${tracked.size} canais acompanhados`);
}
