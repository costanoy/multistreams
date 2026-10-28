import { config, enabled } from './config.js';
import * as db from './db.js';
import * as kick from './kick.js';
import * as twitch from './twitch.js';
import { CHANNEL_ID, FetchResult, Live, Platform, PLATFORMS, Status } from './types.js';
import * as youtube from './youtube.js';

/**
 * Registro de canais acompanhados. O polling é por canal, não por usuário:
 * mil pessoas seguindo o mesmo streamer geram uma consulta só.
 */

/** Status salvo no banco: o do app mais o controle do aviso (o /status não manda os campos extras). */
export type StoredStatus = Status & {
  /** quando saiu o último "está ao vivo" e o início da live avisada: a mesma live nunca é avisada duas vezes */
  notifiedAt?: string;
  notifiedStart?: string | null;
  /** estreia do YouTube: aparece ao vivo, mas não gera aviso nem conta como live encerrada */
  premiere?: boolean;
  /** offline sem confirmação: canal novo que a plataforma não respondeu em 3 rodadas */
  stale?: boolean;
  /** Twitch: a Get Videos do canal novo já foi feita (mesmo sem VOD); sem a marca, a rodada que o confirmar offline a refaz */
  lastChecked?: boolean;
};

export interface Tracked {
  platform: Platform;
  channelId: string;
  status: StoredStatus | null;
  /** última vez que algum app pediu este canal (ou que ele apareceu em follows) */
  wantedAt: number;
  /** o wantedAt que já está no banco */
  wantedSaved: number;
  /** início da consulta que gerou o status atual: o resultado de uma consulta mais velha não sobrescreve */
  observedAt: number;
  /** rodadas seguidas em que a plataforma não respondeu por este canal */
  misses: number;
}

const tracked = new Map<string, Tracked>();
/** canal que nenhuma conta segue sai do registro 2 dias depois do último pedido */
const KEEP_MS = 2 * 24 * 3600e3;
/** chaves por pedido no /status (o resto é cortado) e, delas, quantas novas entram no registro */
export const MAX_KEYS = 2000;
const MAX_NEW = 100;
/** carência do aviso: a live que volta em menos de 10 min é a mesma (queda de conexão) */
const GRACE_MS = 10 * 60e3;
/** rodadas sem resposta até o status ser dado como velho (canal sem status: até virar offline) */
const MAX_MISSES = 3;
/** sem confirmação nenhuma por 1 h (worker parado, plataforma desligada), o status também é velho */
const STALE_MS = 3600e3;
/** quanto o /status espera a primeira consulta dos canais novos e, na partida, a carga do banco (depois, não registra canal novo) */
const FIRST_WAIT_MS = 6000;
const LOAD_WAIT_MS = 15000;
/** canal novo que a plataforma nunca confirmou (stale): o /status não renova o prazo e ele sai do registro 1 h depois */
const NEVER_MS = 3600e3;
const EPOCH = new Date(0).toISOString();
const LABEL: Record<Platform, string> = { twitch: 'Twitch', youtube: 'YouTube', kick: 'Kick' };

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
const sleep = (n: number) => new Promise<void>(r => setTimeout(r, Math.max(0, n)).unref());

/** `${platform}:${channelId}`, com o id no formato da plataforma; qualquer outra coisa é ignorada. */
export const parseKey = (key: string): { platform: Platform; channelId: string } | null => {
  const i = key.indexOf(':');
  if (i < 1) return null;
  const platform = key.slice(0, i) as Platform;
  const channelId = key.slice(i + 1);
  return PLATFORMS.includes(platform) && CHANNEL_ID[platform].test(channelId) ? { platform, channelId } : null;
};

/** Chaves de um pedido ao /status: válidas, sem repetição e no máximo MAX_KEYS (truncated = cortou). */
export function pickKeys(raw: unknown[]): { keys: string[]; truncated: boolean } {
  const keys = new Set<string>();
  for (const k of raw) {
    if (typeof k !== 'string' || keys.has(k) || !parseKey(k)) continue;
    if (keys.size >= MAX_KEYS) return { keys: [...keys], truncated: true };
    keys.add(k);
  }
  return { keys: [...keys], truncated: false };
}

/** Chave dos limites por IP: o IPv4 inteiro; no IPv6, o /64 (cada aparelho costuma ter um /64 inteiro). */
export function ipKey(ip: string): string {
  const a = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');
  const v4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a);
  if (v4) return v4[1];
  if (!a.includes(':')) return a;
  const [head, tail] = a.split('%')[0].split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const full = tail === undefined ? h : [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  return `${full.slice(0, 4).map(x => x.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

/** O /48 de uma chave IPv6 de ipKey, para um limite agregado da rede inteira; null no IPv4. */
export function ip48(key: string): string | null {
  const m = /^([0-9a-f]{1,4}):([0-9a-f]{1,4}):([0-9a-f]{1,4}):[0-9a-f]{1,4}::\/64$/.exec(key);
  return m ? `${m[1]}:${m[2]}:${m[3]}::/48` : null;
}

/**
 * Orçamento por chave numa janela fixa: take(k, n) gasta até n e devolve quanto conseguiu. Com vários
 * orçamentos em série, consulte left() de todos e gaste só o mínimo, para um não ser gasto à toa quando outro corta.
 */
export class Budget {
  private used = new Map<string, { n: number; until: number }>();
  constructor(private size: number, private windowMs: number, private maxKeys = 50000) {}

  /** quanto ainda dá para gastar agora, sem gastar */
  left(key: string, now = Date.now()): number {
    const u = this.used.get(key);
    return !u || now >= u.until ? this.size : Math.max(0, this.size - u.n);
  }

  take(key: string, n = 1, now = Date.now()): number {
    let u = this.used.get(key);
    if (!u || now >= u.until) {
      this.used.delete(key);
      if (this.used.size >= this.maxKeys) this.trim(now);
      this.used.set(key, (u = { n: 0, until: now + this.windowMs }));
    }
    const got = Math.max(0, Math.min(n, this.size - u.n));
    u.n += got;
    return got;
  }

  /** tira as janelas vencidas; se ainda passar do teto, as mais antigas */
  private trim(now: number) {
    for (const [k, u] of this.used) if (now >= u.until) this.used.delete(k);
    for (const k of this.used.keys()) {
      if (this.used.size < this.maxKeys) break;
      this.used.delete(k);
    }
  }
}

/** Avisar? Só numa live nova de verdade: nunca na primeira observação, numa estreia, duas vezes na mesma live ou numa volta rápida. */
export function shouldNotify(prev: StoredStatus | null, live: Live, now: number): boolean {
  if (!prev || prev.stale || live.premiere) return false;
  if (live.startedAt && prev.notifiedStart === live.startedAt) return false;
  const start = ms(live.startedAt);
  const at = Number.isFinite(start) ? start : now;
  // seguia ao vivo: só é outra live se começou bem depois da última confirmação da anterior
  if (prev.live && !prev.premiere) return !!live.startedAt && live.startedAt !== prev.startedAt && at - ms(prev.checkedAt) > GRACE_MS;
  // estava offline (a estreia conta como offline): carência contada do fim da live anterior
  return !(at - ms(prev.lastLiveAt) < GRACE_MS);
}

/**
 * Próximo status de um canal a partir do resultado da plataforma. confirmed = false só para o canal
 * novo que a plataforma não respondeu em 3 rodadas: vira offline, marcado como velho.
 */
export function nextStatus(prev: StoredStatus | null, live: Live | undefined, endedAt: string | null | undefined, now: number, confirmed = true) {
  const iso = new Date(now).toISOString();
  const ended = ms(endedAt);
  const endedOk = !!endedAt && ended <= now;
  let lastLiveAt = prev?.lastLiveAt ?? null;
  if (prev?.live && !live) {
    // acabou agora: o fim informado pela plataforma, se for desta live; senão, agora (estreia não conta)
    if (!prev.premiere) lastLiveAt = endedOk && !(ended < ms(prev.startedAt ?? prev.lastLiveAt)) ? endedAt : iso;
  } else if (endedOk && !(ended <= ms(lastLiveAt))) lastLiveAt = endedAt;
  const notify = !!live && confirmed && shouldNotify(prev, live, now);
  const status: StoredStatus = live
    ? { live: true, viewers: live.viewers, title: live.title, cat: live.cat, thumb: live.thumb, lang: live.lang, startedAt: live.startedAt, lastLiveAt, url: live.url, checkedAt: iso }
    : { live: false, viewers: 0, title: '', cat: '', thumb: null, lang: prev?.lang ?? null, startedAt: null, lastLiveAt, url: null, checkedAt: iso };
  if (live?.premiere) status.premiere = true;
  if (!confirmed) status.stale = true;
  if (prev?.lastChecked) status.lastChecked = true;
  if (notify) Object.assign(status, { notifiedAt: iso, notifiedStart: live!.startedAt });
  else if (prev?.notifiedAt) Object.assign(status, { notifiedAt: prev.notifiedAt, notifiedStart: prev.notifiedStart ?? null });
  const changed = !prev || prev.live !== status.live || prev.lastLiveAt !== status.lastLiveAt || !!prev.stale !== !!status.stale || notify;
  return { status, notify, changed: changed || status.live };
}

/** Aplica um resultado ao canal; ignora o que vier de uma consulta mais velha que a do status atual. */
export function applyTo(t: Tracked, live: Live | undefined, endedAt: string | null | undefined, observedAt: number, now = Date.now(), confirmed = true) {
  if (observedAt < t.observedAt) return null;
  t.observedAt = observedAt;
  if (confirmed) t.misses = 0;
  const r = nextStatus(t.status, live, endedAt, now, confirmed);
  t.status = r.status;
  return r;
}

/** O que o app recebe: sem os campos internos. Status velho de quem estava ao vivo vira offline com stale: true. */
export function publicStatus(s: StoredStatus, stale: boolean): Status & { stale?: boolean } {
  const { notifiedAt: _n, notifiedStart: _s, premiere: _p, stale: _st, lastChecked: _l, ...pub } = s;
  if (!stale) return pub;
  if (!s.live) return { ...pub, stale: true };
  return { ...pub, live: false, viewers: 0, title: '', cat: '', thumb: null, startedAt: null, lastLiveAt: s.checkedAt, url: null, stale: true };
}

const newer = (a: string | null, b: string | null) => (!a || (b && ms(b) > ms(a)) ? b : a);

/**
 * Status de quem foi consultado antes de a carga da partida chegar, junto com o salvo no banco: fica a última live
 * mais nova (a salva ao vivo acabou no checkedAt dela, como no publicStatus), a língua e o controle do aviso.
 */
export function mergeSaved(cur: StoredStatus, saved: StoredStatus): StoredStatus {
  const end = saved.live && !saved.premiere && !cur.live ? saved.checkedAt : saved.lastLiveAt;
  const out: StoredStatus = { ...cur, lastLiveAt: newer(cur.lastLiveAt, end), lang: cur.lang ?? saved.lang };
  if (!cur.notifiedAt && saved.notifiedAt) Object.assign(out, { notifiedAt: saved.notifiedAt, notifiedStart: saved.notifiedStart ?? null });
  if (saved.lastChecked) out.lastChecked = true;
  return out;
}

/** plataformas com uma rodada concluída neste processo */
const polled = new Set<Platform>();

/**
 * Status velho: nunca confirmado, sem resposta em 3 rodadas ou sem confirmação há 1 h. O offline carregado do banco
 * tem o checkedAt da última mudança (offline igual não é regravado): só fica velho pela idade depois da 1ª rodada.
 */
const isStale = (t: Tracked, now: number) =>
  !!t.status?.stale || t.misses >= MAX_MISSES || (now - ms(t.status?.checkedAt) > STALE_MS && (!!t.status?.live || polled.has(t.platform) || !enabled[t.platform]));

const entry = (p: { platform: Platform; channelId: string }, status: StoredStatus | null, wantedAt: number, wantedSaved = 0): Tracked => ({
  ...p,
  status,
  wantedAt,
  wantedSaved,
  observedAt: ms(status?.checkedAt) || 0,
  misses: 0,
});

const ofPlatform = (p: Platform, keys?: string[]) =>
  (keys ?? [...tracked.keys()]).filter(k => tracked.get(k)?.platform === p);

let fullWarnAt = 0;
function roomFor(followed: boolean): boolean {
  // os seguidos por alguma conta entram mesmo acima do teto (até o dobro, contra uma conta que encha follows)
  if (tracked.size < config.limits.channels * (followed ? 2 : 1)) return true;
  if (Date.now() - fullWarnAt > 10 * 60e3) {
    fullWarnAt = Date.now();
    console.warn(`[registry] teto de ${config.limits.channels} canais: os novos ficam sem status`);
  }
  return false;
}

/** Gravações em andamento: o encerramento espera por elas. */
const saving = new Set<Promise<void>>();
function save(rows: { key: string; status: StoredStatus }[]): Promise<void> {
  if (!rows.length) return Promise.resolve();
  const p: Promise<void> = db
    .saveChannels(rows)
    .catch(e => console.warn('[db] channels', (e as Error).message))
    .finally(() => saving.delete(p));
  saving.add(p);
  return p;
}

const VIDEO_ID = /[?&]v=([\w-]{11})/;

/** YouTube: o vídeo de quem estava ao vivo é conferido sempre, mesmo com o feed fora do ar. */
function knownVideos(keys: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const k of keys) {
    const t = tracked.get(k)!;
    const v = t.status?.live ? VIDEO_ID.exec(t.status.url ?? '')?.[1] : undefined;
    if (v) out.set(t.channelId, [v]);
  }
  return out;
}

async function fetchLive(platform: Platform, keys: string[]): Promise<FetchResult> {
  const ids = keys.map(k => tracked.get(k)!.channelId);
  try {
    if (platform === 'youtube') return await youtube.fetchLive(ids, knownVideos(keys));
    return await (platform === 'twitch' ? twitch : kick).fetchLive(ids);
  } catch (e) {
    // cada lote já tem o próprio try/catch; se ainda assim lançar, a rodada inteira fica sem resposta
    console.warn(`[${platform}] polling:`, (e as Error).message);
    return { live: new Map(), ended: new Map(), unknown: new Set(ids) };
  }
}

export async function poll(platform: Platform, keys?: string[]): Promise<void> {
  if (!enabled[platform]) return;
  const list = ofPlatform(platform, keys);
  if (!list.length) return;
  const observedAt = Date.now();
  const r = await fetchLive(platform, list);
  const now = Date.now();
  const dirty: { key: string; status: StoredStatus }[] = [];
  const news: { key: string; live: Live }[] = [];
  const firstOff: string[] = [];
  for (const k of list) {
    const t = tracked.get(k);
    if (!t) continue; // saiu do registro durante a consulta
    const live = r.live.get(t.channelId);
    let confirmed = true;
    if (!live && r.unknown.has(t.channelId)) {
      // a plataforma não respondeu por este canal: fica o status anterior; sem status, vira offline só na 3ª rodada
      if (++t.misses < MAX_MISSES || t.status) continue;
      confirmed = false;
    }
    // canal novo, nunca confirmado ou offline sem última live e sem a marca (reinício no meio da fila, salvo antes
    // dela): a Twitch busca a última live dele quando a rodada confirmar offline (antes, o VOD pode ser da live no ar)
    const s = t.status;
    const first = !s || !!s.stale || (!s.live && !s.lastLiveAt && !s.lastChecked);
    const res = applyTo(t, live, r.ended.get(t.channelId), observedAt, now, confirmed);
    if (!res) continue;
    if (res.changed) dirty.push({ key: k, status: res.status });
    if (res.notify) news.push({ key: k, live: live! });
    if (platform === 'twitch' && first && confirmed && !live) firstOff.push(k);
  }
  // grava antes de avisar: se o processo cair no meio, o aviso se perde em vez de sair duas vezes
  await save(dirty);
  for (const n of news) void db.notifyLive(n.key, n.live.name ?? '', n.live.title, LABEL[platform], n.live.url);
  if (firstOff.length) queueLastLive(firstOff);
}

// ---- Twitch: data da última live de quem acabou de entrar, em segundo plano ----

/**
 * A Get Videos responde um canal por chamada: fica fora do /status. Corre com 3 consultas por vez e
 * no máximo ~4 por segundo, para sobrar limite da Helix para o polling. A fila é só em memória: o status
 * salvo leva a marca lastChecked, e quem ficou sem ela volta para a fila quando uma rodada o confirmar offline.
 */
const lastQueue = new Set<string>();
const lastBusy = new Set<string>();
const lastDirty = new Set<string>();
const LAST_WORKERS = 3;
const LAST_GAP_MS = 750;
let lastWorkers = 0;

function queueLastLive(keys: string[]) {
  for (const k of keys) if (!lastBusy.has(k)) lastQueue.add(k);
  while (!stopped && lastWorkers < LAST_WORKERS && lastQueue.size) {
    lastWorkers++;
    void lastWorker();
  }
}

/** Ajusta o lastLiveAt de quem segue offline (só se o valor for mais recente que o conhecido) e marca a consulta feita. */
function applyLastLive(key: string, at: string | null): boolean {
  const t = tracked.get(key);
  const s = t?.status;
  // entrou ao vivo (ou saiu do registro) enquanto consultava: não mexe
  if (!t || !s || s.live) return false;
  const a = ms(at);
  const later = a <= Date.now() && !(a <= ms(s.lastLiveAt));
  if (!later && s.lastChecked) return false;
  t.status = { ...s, lastLiveAt: later ? at : s.lastLiveAt, lastChecked: true };
  return true;
}

function flushLast(): Promise<void> {
  const rows: { key: string; status: StoredStatus }[] = [];
  for (const key of lastDirty) {
    const status = tracked.get(key)?.status;
    if (status) rows.push({ key, status });
  }
  lastDirty.clear();
  return save(rows);
}

async function lastWorker(): Promise<void> {
  try {
    while (!stopped && lastQueue.size) {
      const key = lastQueue.values().next().value!;
      lastQueue.delete(key);
      const t = tracked.get(key);
      if (!t?.status || t.status.live) continue;
      const t0 = Date.now();
      lastBusy.add(key);
      try {
        if (applyLastLive(key, await twitch.lastLiveAt(t.channelId))) lastDirty.add(key);
      } finally {
        lastBusy.delete(key);
      }
      if (lastDirty.size >= 100) void flushLast();
      await sleep(LAST_GAP_MS - (Date.now() - t0));
    }
  } finally {
    lastWorkers--;
    if (!lastWorkers) void flushLast();
  }
}

// ---- pedidos dos apps ----

let loading: Promise<void> | null = null;
/**
 * Canais novos pelo /status (contando só os que entram no registro): por IP a cada 10 min e a cada 24 h, no
 * IPv6 também pelo /48 (5 vezes o do IP, além do /64) e, somando todos os IPs, a cada 10 min.
 */
const newPerIp = new Budget(config.limits.newPerIp, 10 * 60e3);
const newPerIpDay = new Budget(config.limits.newPerIpDay, 24 * 3600e3);
const newPerNet = new Budget(5 * config.limits.newPerIp, 10 * 60e3);
const newAll = new Budget(config.limits.newPerWindow, 10 * 60e3);

/**
 * Devolve o status dos canais pedidos. Os desconhecidos entram no registro (até 100 por pedido, dentro dos
 * orçamentos e do teto) e são consultados na hora; a resposta espera essa consulta por até 6 s.
 */
export async function statusFor(keys: string[], client = ''): Promise<Record<string, Status>> {
  // na partida, espera o banco carregar (senão o canal entraria sem o status salvo); se não der, só responde o que conhece
  if (loading) await Promise.race([loading, sleep(LOAD_WAIT_MS)]);
  const open = !loading;
  const now = Date.now();
  const unknown: { key: string; platform: Platform; channelId: string }[] = [];
  for (const key of keys) {
    const t = tracked.get(key);
    if (t) {
      // o que a plataforma nunca confirmou não tem o prazo renovado por aqui (sai do registro em 1 h)
      if (!t.status?.stale) t.wantedAt = now;
      continue;
    }
    const p = parseKey(key);
    if (open && p && enabled[p.platform]) unknown.push({ key, ...p });
  }
  const fresh: string[] = [];
  const want = Math.min(unknown.length, MAX_NEW);
  const net = ip48(client);
  const budgets: [Budget, string][] = [[newPerIp, client], [newPerIpDay, client], [newAll, '*']];
  if (net) budgets.push([newPerNet, net]);
  // os que não couberem ficam sem status agora e entram nos próximos pedidos; cada orçamento gasta só o que todos dão
  const n = want && roomFor(false) ? Math.min(want, config.limits.channels - tracked.size, ...budgets.map(([b, k]) => b.left(k, now))) : 0;
  if (n > 0) for (const [b, k] of budgets) b.take(k, n, now);
  for (const { key, ...p } of unknown.slice(0, n)) {
    tracked.set(key, entry(p, null, now));
    fresh.push(key);
    if (p.platform === 'twitch' && enabled.eventsub) void twitch.subscribeOnline(p.channelId);
  }
  if (fresh.length) {
    const first = Promise.all(PLATFORMS.map(p => poll(p, fresh).catch(e => console.warn(`[${p}] primeira consulta:`, (e as Error).message))));
    // o que não ficar pronto a tempo segue em segundo plano e sai no próximo pedido
    await Promise.race([first, sleep(FIRST_WAIT_MS)]);
  }
  const out: Record<string, Status> = {};
  const at = Date.now();
  for (const key of keys) {
    const t = tracked.get(key);
    if (t?.status) out[key] = publicStatus(t.status, isStale(t, at));
  }
  return out;
}

// ---- EventSub ----

const queued = new Set<string>();
let queueTimer: ReturnType<typeof setTimeout> | null = null;

/** EventSub: só anota o canal. A consulta sai em lote ~5 s depois (a Helix demora a refletir o stream.online). */
export function enqueue(key: string): void {
  if (stopped || !tracked.has(key)) return;
  queued.add(key);
  queueTimer ??= setTimeout(() => void drain(), 5000);
}

async function drain(): Promise<void> {
  const keys = [...queued];
  queued.clear();
  try {
    await poll('twitch', keys);
  } catch (e) {
    console.warn('[twitch] eventsub:', (e as Error).message);
  } finally {
    queueTimer = null;
    if (queued.size && !stopped) queueTimer = setTimeout(() => void drain(), 5000);
  }
}

// ---- rodadas, seguidos e limpeza ----

let stopped = false;
const timers: ReturnType<typeof setInterval>[] = [];
const running = new Set<Platform>();

/** Rodada periódica: se a anterior ainda não acabou, esta é pulada (nunca duas da mesma plataforma juntas). */
async function round(p: Platform): Promise<void> {
  if (stopped || running.has(p)) return;
  running.add(p);
  try {
    await poll(p);
  } catch (e) {
    console.warn(`[${p}] polling:`, (e as Error).message);
  } finally {
    running.delete(p);
    polled.add(p);
  }
}

/** created_at mais novo já lido em follows (null = a leitura completa ainda não deu certo) */
let followsSince: string | null = null;
let followsAt = 0;

/** Seguidos por alguma conta: entram no registro com prioridade e o prazo deles é renovado. */
function addFollowed(keys: string[], now: number) {
  for (const key of keys) {
    const t = tracked.get(key);
    if (t) {
      t.wantedAt = now;
      continue;
    }
    const p = parseKey(key);
    if (!p || !roomFor(true)) continue;
    tracked.set(key, entry(p, null, now));
    if (p.platform === 'twitch' && enabled.eventsub) void twitch.subscribeOnline(p.channelId);
  }
}

/** A cada 2 min, só os follows novos: uma importação entra no registro sem esperar a hora cheia. */
async function refreshFollows(): Promise<void> {
  if (stopped || !followsSince) return;
  try {
    const r = await db.followedKeys(followsSince);
    addFollowed(r.keys, Date.now());
    if (r.latest) followsSince = r.latest;
  } catch (e) {
    console.warn('[db] follows novos', (e as Error).message);
  }
}

/** Grava o prazo dos canais pedidos desde a última gravação. */
async function writeWanted(): Promise<boolean> {
  const rows: { key: string; wantedAt: number }[] = [];
  for (const [key, t] of tracked) if (t.wantedAt !== t.wantedSaved) rows.push({ key, wantedAt: t.wantedAt });
  if (!(await db.saveWanted(rows))) return false;
  for (const { key, wantedAt } of rows) {
    const t = tracked.get(key);
    if (t) t.wantedSaved = wantedAt;
  }
  return true;
}

let maintaining = false;

/** De hora em hora (e na partida): relê follows, grava o prazo e tira quem ninguém pede há 2 dias (o nunca confirmado, há 1 h). */
async function maintain(): Promise<void> {
  if (stopped || maintaining) return;
  maintaining = true;
  try {
    const now = Date.now();
    if (now - followsAt > 10 * 60e3) {
      try {
        const r = await db.followedKeys();
        addFollowed(r.keys, now);
        followsSince = r.latest ?? followsSince ?? EPOCH;
        followsAt = now;
      } catch (e) {
        // sem saber quem é seguido, não apaga nada
        console.warn('[db] follows', (e as Error).message);
        return;
      }
    }
    const saved = await writeWanted();
    const cutoff = now - KEEP_MS;
    // sem pedido há 2 dias; o que a plataforma nunca confirmou (o /status não renova o prazo), 1 h depois
    const old = [...tracked].filter(([, t]) => t.wantedAt < (t.status?.stale ? now - NEVER_MS : cutoff)).map(([k]) => k);
    const never = old.filter(k => tracked.get(k)!.status?.stale);
    for (const k of old) {
      tracked.delete(k);
      lastQueue.delete(k);
    }
    if (old.length > never.length) console.log(`[registry] ${old.length - never.length} canais sem pedido há 2 dias saíram do registro`);
    if (never.length) console.log(`[registry] ${never.length} canais que a plataforma nunca confirmou saíram do registro`);
    // com o prazo no banco, a limpeza é por idade (só depois de gravar o de todos); sem ele, pelas chaves
    if (db.hasWantedAt()) {
      if (saved) await db.removeOlderThan(new Date(cutoff).toISOString());
      // o nunca confirmado sai do banco já (pela idade, ficaria 2 dias e voltaria num reinício)
      await db.removeChannels(never);
    } else await db.removeChannels(old);
  } finally {
    maintaining = false;
  }
}

/** Carga da partida: os seguidos primeiro (prioridade no teto), depois os pedidos mais recentes. */
async function load(): Promise<void> {
  const now = Date.now();
  const [rows, follows] = await Promise.all([
    db.loadChannels().catch(e => {
      console.warn('[db] não foi possível carregar os canais:', (e as Error).message);
      return [];
    }),
    db.followedKeys().catch(e => {
      console.warn('[db] follows', (e as Error).message);
      return null;
    }),
  ]);
  const byKey = new Map(rows.map(r => [r.key, r]));
  let skipped = 0;
  const merged = new Map<string, StoredStatus>();
  const put = (key: string, followed: boolean) => {
    const row = byKey.get(key);
    const status = (row?.status ?? null) as StoredStatus | null;
    const t = tracked.get(key);
    if (t) {
      // o /status chegou antes: completa com o status salvo ou, se já consultou, junta os dois (sem decidir aviso)
      if (followed) t.wantedAt = now;
      if (!status || t.status === status) return;
      if (!t.status) Object.assign(t, { status, observedAt: ms(status.checkedAt) || 0 });
      // o seguido passa aqui duas vezes: junta uma só (o upsert recusa o lote com a chave repetida)
      else if (!merged.has(key)) merged.set(key, (t.status = mergeSaved(t.status, status)));
      return;
    }
    const p = parseKey(key);
    // sem pedido há mais de 2 dias e sem conta que siga: nem entra (a limpeza apaga a linha)
    if (!p || (!followed && now - (row?.wantedAt ?? now) > KEEP_MS)) return;
    if (tracked.size >= config.limits.channels * (followed ? 2 : 1)) {
      skipped++;
      return;
    }
    tracked.set(key, entry(p, status, followed ? now : row?.wantedAt ?? now, row?.wantedAt ?? 0));
  };
  if (follows) {
    for (const k of follows.keys) put(k, true);
    followsSince = follows.latest ?? EPOCH;
    followsAt = now;
  }
  for (const r of [...rows].sort((a, b) => (b.wantedAt ?? now) - (a.wantedAt ?? now))) put(r.key, false);
  if (skipped) console.warn(`[registry] teto de ${config.limits.channels} canais: ${skipped} do banco ficaram de fora`);
  // a 1ª consulta gravou por cima do salvo: o que juntou volta para o banco
  void save([...merged].map(([key, status]) => ({ key, status })));
}

export async function start(): Promise<void> {
  // loading volta a null antes de quem espera a carga seguir: o /status sabe se ela terminou
  loading = load().finally(() => {
    loading = null;
  });
  await loading;
  if (stopped) return;
  void maintain();
  timers.push(setInterval(() => void maintain(), 3600e3), setInterval(() => void refreshFollows(), 2 * 60e3));
  for (const p of PLATFORMS) {
    if (!enabled[p]) continue;
    void round(p);
    timers.push(setInterval(() => void round(p), config.poll[p]));
  }
  if (enabled.eventsub) for (const k of ofPlatform('twitch')) void twitch.subscribeOnline(tracked.get(k)!.channelId);
  console.log(`[registry] ${tracked.size} canais acompanhados`);
}

/** Encerramento (SIGTERM): para os timers e grava o que estiver pendente. */
export async function stop(): Promise<void> {
  stopped = true;
  for (const t of timers) clearInterval(t);
  if (queueTimer) clearTimeout(queueTimer);
  await Promise.allSettled([...saving, flushLast(), writeWanted(), youtube.flush()]);
}
