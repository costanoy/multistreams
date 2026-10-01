# Multistreams

Quem dos seus streamers da Twitch, do YouTube e da Kick está ao vivo agora, numa lista só.

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

## Publicar na Hostinger

**Site + APK** (`multistreams.cyberhat.com.br`): em `client/`, com a senha da chave do APK numa variável, rode `.\scripts\build-release.ps1`. Ele gera `client/dist/` com o site, o `.htaccess` e o `multistreams.apk` assinado. Suba o **conteúdo** de `client/dist/` para a pasta do domínio (`public_html`).

A chave que assina o APK fica fora do projeto, em `%USERPROFILE%\multistreams-android-keystore\`. Guarde uma cópia: sem ela não dá para publicar atualizações do app.

**Worker** (`api.multistreams.cyberhat.com.br`): no Render, pelo `render.yaml` da raiz (New → Blueprint → este repositório). As chaves são pedidas na criação e ficam só no Render. O domínio é um CNAME na zona de DNS da Hostinger apontando para o endereço `.onrender.com` do serviço. No plano grátis o serviço dorme após 15 min sem acesso; um monitor de uptime batendo em `/health` a cada 5 min o mantém acordado.

Se um dia o plano da Hostinger tiver Node.js, `deploy/worker-hostinger.zip` também serve (arquivo de entrada `dist/index.js`).

## Produção

- **Worker:** Railway ou Fly (precisa ficar sempre no ar; serverless não serve). `npm start`. Com `PUBLIC_URL` + `TWITCH_EVENTSUB_SECRET`, a Twitch passa a avisar por EventSub em tempo real; o polling continua como garantia.
- **Web:** `cd client && npx expo export --platform web` gera `dist/` (SPA estática).
- **Lojas:** `eas build` + `eas submit`. Troque `com.multistreams.app` em `client/app.json` pelo identificador definitivo.

## Aba Ao vivo

Três modos, todos filtrados pelas línguas e plataformas marcadas (mínimo de uma de cada; na primeira vez só a língua do aparelho vem marcada):

- **Mais espectadores** (padrão) e **Menos espectadores**: lista infinita de quem está no ar (`GET /browse?sort=desc|asc&offset&limit` no worker, 50 por página).
- **Seguindo**: a lista do usuário, com a seção Offline e o botão "+ Adicionar streamer". A lista vem da importação (login com Twitch e Google) e dos canais adicionados por link. A Kick não tem API de seguidos, então os canais dela entram só pelo link.

**Categorias** (jogos, IRL, Just Chatting…): o painel lista as categorias de quem está ao vivo agora, com as plataformas e a soma de viewers (`GET /categories`). A mesma categoria em plataformas diferentes é juntada pelo nome ("Grand Theft Auto V (GTA)" na Kick = "Grand Theft Auto V" na Twitch). Nenhuma marcada = todas. No YouTube as categorias são as genéricas dele (Jogos, Entretenimento…), não o nome do jogo.

O que cada plataforma permite:

- **Twitch:** todas as lives. O worker varre a Get Streams página a página (em português são ~90 páginas, ~20 s) e refaz a varredura a cada 3 minutos enquanto alguém estiver usando. Durante a primeira varredura a lista vai crescendo.
- **Kick:** a API não pagina e devolve no máximo 100 lives por consulta. O worker pede as 100 maiores de cada língua e, de novo, as 100 maiores das 10 categorias mais fortes de cada língua (a lista geral da Kick deixa lives grandes de fora). Com categoria marcada, pede as 100 maiores daquela categoria.
- **YouTube:** não existe consulta de "todas as lives". O worker busca "ao vivo" (ou o equivalente) em cada língua, ~50 por língua, redescobertas a cada `BROWSE_YOUTUBE_MINUTES` (padrão 60) e com teto diário de cota `BROWSE_YOUTUBE_BUDGET` (padrão 6.000 das 10.000). É uma lista aproximada.

Por isso "Menos espectadores" só é completo na Twitch; na Kick e no YouTube só entram as lives que aparecem nessas consultas.

## Notas de API

- **Twitch:** Helix `Get Streams` (100 canais por chamada, a cada 60s) + EventSub opcional.
- **YouTube:** feed RSS do canal (sem cota) para achar vídeos recentes e `videos.list` (1 unidade por 50 vídeos) só para os que ainda podem estar ao vivo. A busca tenta o `@handle` (1 unidade) antes de cair no `search.list` (100 unidades).
- **Kick:** API pública oficial. Não tem busca por nome (só slug exato) nem número de seguidores.
- **Idioma:** se a plataforma não informa o idioma da live, vale o idioma cadastrado no streamer.
