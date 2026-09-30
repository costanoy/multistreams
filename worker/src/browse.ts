import { enabled } from './config.js';
import * as kick from './kick.js';
import * as twitch from './twitch.js';
import { BrowseItem, Platform } from './types.js';
import * as youtube from './youtube.js';

/**
 * Lista "tudo ao vivo": as lives com mais viewers de cada plataforma, por língua.
 * O resultado de cada par plataforma+língua fica em cache, então mil apps abertos
 * geram uma consulta só.
 */
const api = { twitch, youtube, kick };
const TTL: Record<Platform, number> = { twitch: 60e3, kick: 60e3, youtube: 180e3 };
const cache = new Map<string, { at: number; items: BrowseItem[]; pending?: Promise<BrowseItem[]> }>();

async function top(platform: Platform, lang: string): Promise<BrowseItem[]> {
  const k = `${platform}:${lang}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL[platform]) return hit.items;
  if (hit?.pending) return hit.pending;
  const pending = api[platform]
    .topLive(lang)
    .then(items => {
      cache.set(k, { at: Date.now(), items });
      return items;
    })
    .catch(e => {
      console.warn(`[${platform}] tudo ao vivo (${lang}):`, e.message);
      // falhou: serve o que tinha e só tenta de novo no próximo ciclo
      const items = hit?.items ?? [];
      cache.set(k, { at: Date.now(), items });
      return items;
    });
  cache.set(k, { at: hit?.at ?? 0, items: hit?.items ?? [], pending });
  return pending;
}

export async function browse(platforms: Platform[], langs: string[]): Promise<BrowseItem[]> {
  const lists = await Promise.all(platforms.filter(p => enabled[p]).flatMap(p => langs.map(l => top(p, l))));
  const seen = new Set<string>();
  return lists
    .flat()
    .filter(i => !seen.has(i.key) && !!seen.add(i.key))
    .sort((a, b) => b.viewers - a.viewers)
    .slice(0, 200);
}
