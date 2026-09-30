try {
  process.loadEnvFile();
} catch {
  // sem .env: usa as variáveis do ambiente (Railway/Fly)
}

const env = (k: string) => process.env[k]?.trim() || '';
const secs = (k: string, def: number) => (Number(env(k)) || def) * 1000;

export const config = {
  port: Number(env('PORT')) || 8787,
  twitch: { id: env('TWITCH_CLIENT_ID'), secret: env('TWITCH_CLIENT_SECRET') },
  youtube: { key: env('YOUTUBE_API_KEY') },
  kick: { id: env('KICK_CLIENT_ID'), secret: env('KICK_CLIENT_SECRET') },
  supabase: { url: env('SUPABASE_URL'), key: env('SUPABASE_SERVICE_ROLE_KEY') },
  publicUrl: env('PUBLIC_URL').replace(/\/$/, ''),
  eventsubSecret: env('TWITCH_EVENTSUB_SECRET'),
  poll: { twitch: secs('POLL_TWITCH', 60), kick: secs('POLL_KICK', 60), youtube: secs('POLL_YOUTUBE', 180) },
};

export const enabled = {
  twitch: !!(config.twitch.id && config.twitch.secret),
  youtube: !!config.youtube.key,
  kick: !!(config.kick.id && config.kick.secret),
  supabase: !!(config.supabase.url && config.supabase.key),
  eventsub: !!(config.publicUrl && config.eventsubSecret),
};
