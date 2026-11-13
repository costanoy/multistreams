<p align="center">
  <a href="https://multistreams.cyberhat.com.br"><b>multistreams.cyberhat.com.br</b></a>
</p>

# Multistreams

Quem dos seus streamers da Twitch, do YouTube e da Kick está ao vivo agora, numa lista só. Funciona na web e no Android, com filtros por idioma e categoria.

**Tecnologias:** TypeScript, React Native (Expo), Node.js, Supabase (PostgreSQL).

| Pasta | O que é |
| --- | --- |
| `client/` | App Expo (React Native + TypeScript, expo-router): iOS, Android e web com o mesmo código |
| `worker/` | Processo contínuo (Node) que consulta as plataformas **por canal**, guarda o status e dispara o push |
| `supabase/schema.sql` | Tabelas e RLS (contas, listas, tokens de push, status dos canais) |
| `design_handoff_multistreams/` | Referência de design (protótipo HTML + brief) |

O app nunca fala direto com as plataformas para saber quem está ao vivo: ele pergunta ao worker (`POST /status`), que consulta cada canal uma vez só, não importa quantas pessoas o sigam.

## Rodar local

### 1. Worker

```bash
cd worker
cp .env.example .env   # preencha as credenciais
npm install
npm run dev            # http://localhost:8787/health mostra o que está ligado
```

Cada plataforma só liga se tiver credencial. Onde pegar:

- **Twitch:** crie um app em https://dev.twitch.tv/console/apps → `TWITCH_CLIENT_ID` e `TWITCH_CLIENT_SECRET`.
- **YouTube:** no Google Cloud, ative a *YouTube Data API v3* e crie uma API key → `YOUTUBE_API_KEY`.
- **Kick:** crie um app em https://kick.com/settings/developer → `KICK_CLIENT_ID` e `KICK_CLIENT_SECRET`.

### 2. App

```bash
cd client
cp .env.example .env   # EXPO_PUBLIC_API_URL aponta para o worker
npm install
npx expo start         # w = web, a = Android, i = iOS
```

No celular físico, `EXPO_PUBLIC_API_URL` precisa ser o IP da máquina na rede (ex.: `http://192.168.0.10:8787`), não `localhost`.

Sem Supabase o app já funciona no modo "sem conta": a lista fica salva no aparelho.

### 3. Contas, sincronização, importação e push (Supabase)

1. Crie um projeto no Supabase e rode `supabase/schema.sql` no SQL Editor.
2. Em *Authentication → Providers*, ligue **Twitch** e **Google** com os Client ID/Secret de cada um (no Google, adicione o escopo `youtube.readonly` na tela de consentimento).
3. Em *Authentication → Sign In / Providers*, ligue **Manual linking** (permite conectar Twitch e Google na mesma conta para importar dos dois).
4. Em *Authentication → URL Configuration*, adicione às Redirect URLs: a URL do site, `http://localhost:8081/**` e `multistreams://**`.
5. `client/.env`: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_TWITCH_CLIENT_ID`.
6. `worker/.env`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (o worker passa a persistir os canais e a enviar push).
7. Push exige um build próprio (não funciona no Expo Go): `npx eas-cli@latest init` e depois `eas build`. O token do aparelho é gravado em `push_tokens` no login.

## Produção

- **Worker:** Railway ou Fly (precisa ficar sempre no ar; serverless não serve). `npm start`. Com `PUBLIC_URL` + `TWITCH_EVENTSUB_SECRET`, a Twitch passa a avisar por EventSub em tempo real; o polling continua como garantia.
- **Web:** `cd client && npx expo export --platform web` gera `dist/` (SPA estática).
- **Lojas:** `eas build` + `eas submit`. Troque `com.multistreams.app` em `client/app.json` pelo identificador definitivo.

## Notas de API

- **Twitch:** Helix `Get Streams` (100 canais por chamada, a cada 60s) + EventSub opcional.
- **YouTube:** feed RSS do canal (sem cota) para achar vídeos recentes e `videos.list` (1 unidade por 50 vídeos) só para os que ainda podem estar ao vivo. A busca tenta o `@handle` (1 unidade) antes de cair no `search.list` (100 unidades).
- **Kick:** API pública oficial. Não tem busca por nome (só slug exato) nem número de seguidores.
- **Idioma:** se a plataforma não informa o idioma da live, vale o idioma cadastrado no streamer.
