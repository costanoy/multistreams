import { enabled } from './config.js';
import * as kick from './kick.js';
import * as twitch from './twitch.js';
import { BrowseItem, Platform, catKey } from './types.js';
import * as youtube from './youtube.js';

/**
 * Lista "tudo ao vivo". Cada fonte vira um retrato (snapshot) em cache, reaproveitado por
 * todos os apps abertos:
 * - Twitch: todas as lives das línguas pedidas, varridas página a página;
 * - Kick: as 100 maiores por língua (a API não pagina), mais as 100 maiores de cada categoria filtrada;
 * - YouTube: as ~50 maiores por língua (limitado pela cota).
 */
interface Snap {
  at: number;
  items: BrowseItem[];
  complete: boolean;
  building: boolean;
}

const TTL: Record<Platform, number> = { twitch: 180e3, kick: 60e3, youtube: 180e3 };
const snaps = new Map<string, Snap>();

const byViewers = (a: BrowseItem, b: BrowseItem) => b.viewers - a.viewers;

function dedupe(items: BrowseItem[]): BrowseItem[] {
  const seen = new Set<string>();
  return items.filter(i => !seen.has(i.key) && !!seen.add(i.key));
}

/** Monta (ou devolve do cache) um retrato. Na primeira vez, espera ao menos a primeira página. */
function snapshot(key: string, ttl: number, build: (onPage: (items: BrowseItem[]) => void) => Promise<unknown>): Promise<Snap> {
  const snap = snaps.get(key);
  if (snap && (snap.building || Date.now() - snap.at < ttl)) return Promise.resolve(snap);

  const cur: Snap = snap ?? { at: 0, items: [], complete: false, building: true };
  cur.building = true;
  snaps.set(key, cur);
  let firstPage!: () => void;
  const ready = new Promise<void>(r => (firstPage = r));
  const acc: BrowseItem[] = [];
  const onPage = (items: BrowseItem[]) => {
    acc.push(...items);
    // sem retrato anterior, mostra o que já chegou enquanto a varredura continua
    if (!cur.at) cur.items = dedupe(acc);
    firstPage();
  };
  build(onPage)
    .then(() => Object.assign(cur, { at: Date.now(), items: dedupe(acc).sort(byViewers), complete: true }))
    .catch(e => {
      console.warn(`[browse] ${key}:`, e.message);
      // falhou: mantém o que tinha e só tenta de novo depois do TTL
      if (!cur.at) Object.assign(cur, { items: dedupe(acc).sort(byViewers), complete: true });
      cur.at = Date.now();
    })
    .finally(() => {
      cur.building = false;
      firstPage();
    });
  return snap?.at ? Promise.resolve(cur) : ready.then(() => cur);
}

const perLang = (platform: 'kick' | 'youtube', langs: string[], fetch: (l: string) => Promise<BrowseItem[]>) =>
  (onPage: (items: BrowseItem[]) => void) =>
    Promise.all(langs.map(l => fetch(l).then(onPage, e => console.warn(`[${platform}] tudo ao vivo (${l}):`, e.message))));

/**
 * A lista geral da Kick deixa de fora lives grandes (vimos uma de 49 mil fora do "top 100" de
 * português). Por isso, além dela, busca as 100 maiores de cada uma das categorias mais fortes.
 */
const KICK_TOP_CATS = 10;
async function kickWide(lang: string): Promise<BrowseItem[]> {
  const base = await kick.topLive(lang);
  const weight = new Map<number, number>();
  for (const i of base) if (i.catId) weight.set(i.catId, (weight.get(i.catId) ?? 0) + i.viewers);
  const top = [...weight].sort((a, b) => b[1] - a[1]).slice(0, KICK_TOP_CATS).map(([id]) => id);
  const more = await Promise.all(top.map(id => kick.topLive(lang, id).catch(() => [])));
  return [...base, ...more.flat()];
}

function source(p: Platform, langs: string[]): Promise<Snap> {
  const key = `${p}|${langs.join(',')}`;
  if (p === 'twitch') return snapshot(key, TTL.twitch, onPage => twitch.crawlLive(langs, onPage));
  return snapshot(key, TTL[p], perLang(p, langs, l => (p === 'kick' ? kickWide(l) : youtube.topLive(l))));
}

/** Na Kick, o geral só traz 100 lives por língua: com categoria marcada, busca as 100 maiores de cada uma. */
async function kickCategories(langs: string[], cats: string[], base: Snap): Promise<Snap[]> {
  const ids = new Set<number>();
  for (const name of cats.slice(0, 10)) {
    const k = catKey(name);
    base.items.filter(i => i.catId && catKey(i.cat) === k).forEach(i => ids.add(i.catId!));
    try {
      (await kick.categoryIds(name)).forEach(id => ids.add(id));
    } catch (e) {
      console.warn('[kick] categorias:', (e as Error).message);
    }
  }
  return Promise.all(
    [...ids].slice(0, 20).map(id => snapshot(`kick|${langs.join(',')}|cat:${id}`, TTL.kick, perLang('kick', langs, l => kick.topLive(l, id)))),
  );
}

/** Junção ordenada das fontes, guardada até alguma fonte mudar. */
const merged = new Map<string, { stamp: string; desc: BrowseItem[] }>();

async function collect(platforms: Platform[], langs: string[], cats: string[]) {
  const on = platforms.filter(p => enabled[p]).sort();
  const ls = [...langs].sort();
  const parts = await Promise.all(on.map(p => source(p, ls)));
  if (cats.length && on.includes('kick')) parts.push(...(await kickCategories(ls, cats, parts[on.indexOf('kick')])));
  const want = new Set(cats.map(catKey));
  const key = `${on.join()}|${ls.join()}|${[...want].sort().join('|')}`;
  const stamp = parts.map(s => `${s.at}:${s.items.length}`).join('|');
  let m = merged.get(key);
  if (m?.stamp !== stamp) {
    const langSet = new Set(ls);
    m = {
      stamp,
      desc: dedupe(parts.flatMap(s => s.items))
        .filter(i => langSet.has(i.lang) && (!want.size || want.has(catKey(i.cat))))
        .sort(byViewers),
    };
    if (merged.size > 100) merged.clear();
    merged.set(key, m);
  }
  return { desc: m.desc, partial: parts.some(s => !s.complete) };
}

export async function browse(platforms: Platform[], langs: string[], cats: string[], sort: 'desc' | 'asc', offset: number, limit: number) {
  const { desc, partial } = await collect(platforms, langs, cats);
  const total = desc.length;
  const items =
    sort === 'desc' ? desc.slice(offset, offset + limit)
    : desc.slice(Math.max(0, total - offset - limit), Math.max(0, total - offset)).reverse();
  return { total, partial, items };
}

export interface Category {
  key: string;
  name: string;
  viewers: number;
  lives: number;
  platforms: Platform[];
}

/** Categorias de quem está ao vivo agora, das mais assistidas para as menos. */
export async function categories(platforms: Platform[], langs: string[]): Promise<{ partial: boolean; items: Category[] }> {
  const { desc, partial } = await collect(platforms, langs, []);
  const map = new Map<string, Category & { best: number }>();
  for (const i of desc) {
    if (!i.cat) continue;
    const k = catKey(i.cat);
    if (!k) continue;
    let c = map.get(k);
    if (!c) map.set(k, (c = { key: k, name: i.cat, viewers: 0, lives: 0, platforms: [], best: i.viewers }));
    c.viewers += i.viewers;
    c.lives++;
    if (!c.platforms.includes(i.platform)) c.platforms.push(i.platform);
    // o nome que aparece é o da live mais assistida daquela categoria
    if (i.viewers > c.best) Object.assign(c, { name: i.cat, best: i.viewers });
  }
  const items = [...map.values()]
    .sort((a, b) => b.viewers - a.viewers)
    .slice(0, 500)
    .map(({ best: _, ...c }) => c);
  return { partial, items };
}
