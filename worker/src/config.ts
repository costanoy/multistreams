try {
  process.loadEnvFile();
} catch {
  // sem .env: usa as variáveis do ambiente (Render)
}

const env = (k: string) => process.env[k]?.trim() || '';
const num = (k: string, def: number) => Number(env(k)) || def;
const secs = (k: string, def: number) => num(k, def) * 1000;

export const config = {
  port: Number(env('PORT')) || 8787,
  twitch: { id: env('TWITCH_CLIENT_ID'), secret: env('TWITCH_CLIENT_SECRET') },
  youtube: { key: env('YOUTUBE_API_KEY') },
  kick: { id: env('KICK_CLIENT_ID'), secret: env('KICK_CLIENT_SECRET') },
  supabase: { url: env('SUPABASE_URL'), key: env('SUPABASE_SERVICE_ROLE_KEY') },
  publicUrl: env('PUBLIC_URL').replace(/\/$/, ''),
  eventsubSecret: env('TWITCH_EVENTSUB_SECRET'),
  /** de quanto em quanto tempo redescobrir quem está ao vivo no YouTube (cada redescoberta gasta 1 das buscas do dia) */
  browseYoutube: (Number(env('BROWSE_YOUTUBE_MINUTES')) || 120) * 60000,
  /**
   * Cota do YouTube por dia do Pacífico. Desde 01/06/2026 o search.list tem balde próprio (100 chamadas,
   * 1 por chamada) e os outros métodos dividem as 10.000 unidades. browseSearches e browseUnits são o
   * quanto de cada balde a lista "tudo ao vivo" pode gastar; o resto fica para a busca por nome e os seguidos.
   */
  youtubeQuota: {
    units: num('YOUTUBE_UNITS_PER_DAY', 10000),
    searches: num('YOUTUBE_SEARCHES_PER_DAY', 100),
    browseSearches: num('BROWSE_YOUTUBE_SEARCHES', 60),
    browseUnits: num('BROWSE_YOUTUBE_BUDGET', 6000),
  },
  poll: { twitch: secs('POLL_TWITCH', 60), kick: secs('POLL_KICK', 60), youtube: secs('POLL_YOUTUBE', 180) },
  /** proteções das rotas públicas */
  limits: {
    /** canais acompanhados no máximo: acima disso, os novos ficam sem status (os seguidos por alguma conta têm prioridade) */
    channels: num('MAX_CHANNELS', 20000),
    /**
     * canais novos que um mesmo IP pode registrar pelo /status a cada 10 min (no IPv6, a rede /48 tem 5 vezes
     * esse), a cada 24 h, e todos os IPs juntos a cada 10 min
     */
    newPerIp: num('NEW_CHANNELS_PER_IP', 300),
    newPerIpDay: num('NEW_CHANNELS_PER_IP_DAY', 1000),
    newPerWindow: num('NEW_CHANNELS_PER_WINDOW', 2000),
    /** seguidos de uma conta que entram no registro (o resto fica sem polling por follows; o gatilho do banco também para em 3.000) */
    followsPerAccount: num('FOLLOWS_PER_ACCOUNT', 3000),
    /**
     * /search e /resolve fora do cache: pedidos por IP a cada 10 min (folgado: o app busca enquanto a pessoa
     * digita) e por minuto (no IPv6, a rede /48 tem 5 vezes os dois), e por minuto em cada plataforma,
     * somando todos os IPs
     */
    lookupsPerIp: num('LOOKUPS_PER_IP', 120),
    lookupsPerIpMinute: num('LOOKUPS_PER_IP_MINUTE', 20),
    lookupsPerMinute: num('LOOKUPS_PER_MINUTE', 60),
  },
};

export const enabled = {
  twitch: !!(config.twitch.id && config.twitch.secret),
  youtube: !!config.youtube.key,
  kick: !!(config.kick.id && config.kick.secret),
  supabase: !!(config.supabase.url && config.supabase.key),
  eventsub: !!(config.publicUrl && config.eventsubSecret),
};
