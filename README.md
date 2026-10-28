# Multistreams

Quem dos seus streamers da Twitch, do YouTube e da Kick está ao vivo agora, numa lista só.

| Pasta | O que é |
| --- | --- |
| `client/` | App Expo (React Native + TypeScript, expo-router): iOS, Android e web com o mesmo código |
| `worker/` | Processo contínuo (Node) que consulta as plataformas **por canal**, guarda o status e dispara o push |
| `supabase/schema.sql` | Tabelas e RLS (contas, listas, tokens de push, status dos canais) |
| `supabase/migrations/` | Mudanças de banco feitas depois do `schema.sql`, para rodar no SQL Editor |
| `design_handoff_multistreams/` | Referência de design (protótipo HTML + brief) |

O app nunca fala direto com as plataformas para saber quem está ao vivo: ele pergunta ao worker (`POST /status`), que consulta cada canal uma vez só, não importa quantas pessoas o sigam.

## Rodar local

### 1. Worker

```bash
cd worker
cp .env.example .env   # preencha as credenciais
npm install
npm run dev            # http://localhost:8787/health mostra o que está ligado
npm test               # testes do worker
npm run typecheck
```

Os testes (`cd worker && npm test`) trocam as APIs das plataformas por respostas falsas e rodam sem credenciais.

Cada plataforma só liga se tiver credencial. Onde pegar:

- **Twitch:** crie um app em https://dev.twitch.tv/console/apps → `TWITCH_CLIENT_ID` e `TWITCH_CLIENT_SECRET`.
- **YouTube:** no Google Cloud, ative a *YouTube Data API v3* e crie uma API key → `YOUTUBE_API_KEY`.
- **Kick:** crie um app em https://kick.com/settings/developer → `KICK_CLIENT_ID` e `KICK_CLIENT_SECRET`.

**Cota do YouTube.** Desde 01/06/2026 a Data API tem dois baldes por dia, que viram à meia-noite do Pacífico (4h ou 5h em Brasília): 100 chamadas de `search.list` (1 por chamada) e 10.000 unidades para o resto (`videos.list` e `channels.list` custam 1). O worker guarda no banco o quanto já gastou no dia (tabela `kv`, da migração `20261028_endurecimento.sql`), para a conta não zerar quando ele reinicia, e divide os baldes assim (todas opcionais):

| Variável | Padrão | O que faz |
| --- | --- | --- |
| `YOUTUBE_UNITS_PER_DAY` | 10000 | Tamanho do balde de unidades. A lista "tudo ao vivo" e o adicionar canal param antes do fim e deixam uma reserva para o polling dos canais seguidos. |
| `YOUTUBE_SEARCHES_PER_DAY` | 100 | Chamadas de `search.list` por dia. |
| `BROWSE_YOUTUBE_SEARCHES` | 60 | Quantas dessas buscas a lista "tudo ao vivo" pode usar. O resto fica para a busca por nome em Adicionar. |
| `BROWSE_YOUTUBE_BUDGET` | 6000 | Unidades por dia para a lista "tudo ao vivo" (viewers e fotos dos canais). |
| `BROWSE_YOUTUBE_MINUTES` | 120 | Intervalo mínimo entre duas redescobertas de quem está ao vivo numa língua. Fica maior sozinho quando as buscas do dia não dão para todas as línguas pedidas. |

Só mude os dois primeiros se o Google aumentar a cota do projeto.

Quando a cota acaba, a busca do YouTube (`/search`) responde 503 `{ "error": "quota", "bucket": "searches" }` se acabaram as buscas do dia (o `@handle` e o link do canal ainda funcionam, e o app sugere colar o link), e a busca e o link (`/resolve`) respondem `"bucket": "units"` se acabaram as unidades. O `bucket` é um campo novo e opcional: os APKs até a 1.0.4 leem só o `error`. Se o Google responder 403 de cota antes disso, o balde fecha por até 1 h (ou até uma chamada dele dar certo), só no mesmo dia do Pacífico: a lista "tudo ao vivo" e o adicionar canal param, e o polling dos seguidos continua.

**Proteções das rotas públicas** (também opcionais):

| Variável | Padrão | O que faz |
| --- | --- | --- |
| `MAX_CHANNELS` | 20000 | Canais acompanhados no máximo. Acima disso, os novos ficam sem status; os seguidos por alguma conta têm prioridade. |
| `NEW_CHANNELS_PER_IP` | 300 | Canais novos que um mesmo IP pode registrar pelo `/status` a cada 10 min. |
| `NEW_CHANNELS_PER_IP_DAY` | 1000 | Canais novos que um mesmo IP pode registrar pelo `/status` a cada 24 h. |
| `NEW_CHANNELS_PER_WINDOW` | 2000 | Canais novos registrados pelo `/status` a cada 10 min, somando todos os IPs. |
| `FOLLOWS_PER_ACCOUNT` | 3000 | Seguidos de uma conta que o worker acompanha. O resto é ignorado, com um aviso no log. |
| `LOOKUPS_PER_IP` | 120 | Pedidos de `/search` e `/resolve` por IP a cada 10 min. |
| `LOOKUPS_PER_IP_MINUTE` | 20 | Pedidos de `/search` e `/resolve` por IP por minuto. Fica bem abaixo do `LOOKUPS_PER_MINUTE`: senão um IP sozinho fecha a busca de uma plataforma para todos. |
| `LOOKUPS_PER_MINUTE` | 60 | Pedidos de `/search` e `/resolve` por minuto em cada plataforma, somando todos os IPs. |

No Render o IP vem do `CF-Connecting-IP`, que a Cloudflare grava. No IPv6 cada /64 conta como um IP, e a rede /48 inteira tem limites próprios de 5 vezes os do IP (no `/status`, só o de 10 min). O canal que não cabe nos limites do `/status` só fica sem status naquele pedido e entra num dos seguintes: o pedido nunca é recusado. No `/search` e no `/resolve`, a resposta repetida vem do cache (10 min na busca; no link, 6 h se achou e 30 min se não achou) e não conta nos limites. Passou de algum deles, a resposta é 429 `{ "error": "rate_limited" }` com `Retry-After: 60`, e o pedido recusado não gasta nenhum. Além do worker, o banco ignora sem erro os seguidos novos de uma conta que já tem 3.000 (gatilho da migração `20261028_endurecimento.sql`). Com ele, subir `FOLLOWS_PER_ACCOUNT` além disso só alcança os seguidos gravados antes da migração.

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

1. Crie um projeto no Supabase e rode `supabase/schema.sql` no SQL Editor. Depois rode, também no SQL Editor e em ordem de data, os arquivos de `supabase/migrations/`.
2. **Twitch:** no app da Twitch (https://dev.twitch.tv/console/apps), ponha `https://<projeto>.supabase.co/auth/v1/callback` em *OAuth Redirect URLs*. Em *Authentication → Providers*, ligue **Twitch** com o Client ID e o Client Secret **desse mesmo app**. O `EXPO_PUBLIC_TWITCH_CLIENT_ID` do app tem de ser o dele: com o de outro app, a Twitch responde 401 à importação e o login entra num ciclo sem aviso. O worker pode usar o mesmo app.
3. **Google:** no Google Cloud, crie um cliente OAuth do tipo *Aplicativo da Web* com `https://<projeto>.supabase.co/auth/v1/callback` em *URIs de redirecionamento autorizados*, adicione o escopo `youtube.readonly` na tela de consentimento e ligue **Google** em *Authentication → Providers*.
4. Em *Authentication → Sign In / Providers*, ligue **Manual linking** (permite conectar Twitch e Google na mesma conta para importar dos dois).
5. Em *Authentication → URL Configuration*, use `https://multistreams.cyberhat.com.br` como *Site URL* e adicione às *Redirect URLs*: `https://multistreams.cyberhat.com.br/**` (o retorno do login tem caminho, como `/import?from=add`), `http://localhost:8081/**` e `multistreams://**`.
6. `client/.env`: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_TWITCH_CLIENT_ID`.
7. `worker/.env`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (o worker passa a persistir os canais e a enviar push).
8. Push: só no APK e depois dos passos de [Push no Android](#push-no-android). O token do aparelho é gravado em `push_tokens` no login.

## Produção

### Worker no Render

`api.multistreams.cyberhat.com.br` roda no Render, pelo `render.yaml` da raiz (New → Blueprint → este repositório). As chaves são pedidas na criação e ficam só no Render. O domínio é um CNAME na zona de DNS da Hostinger apontando para o endereço `.onrender.com` do serviço.

- O build é `npm ci && npm run build` (esbuild) e o início é `npm start`. Com `autoDeploy`, cada push na branch do Blueprint vira deploy, e cada deploy reinicia o worker: os caches em memória (como a lista "tudo ao vivo") recomeçam do zero.
- Variáveis além das do `render.yaml`: as da [cota do YouTube e das proteções](#1-worker) e `POLL_TWITCH`, `POLL_KICK` e `POLL_YOUTUBE` (segundos), todas com padrão. Com `PUBLIC_URL` e `TWITCH_EVENTSUB_SECRET`, a Twitch passa a avisar por EventSub em tempo real, e o polling continua como garantia. Elas não estão no `render.yaml`: confira no painel se já existem antes de declarar, porque trocar o segredo derruba as inscrições ativas.
- **Banco:** rode `supabase/migrations/20261028_endurecimento.sql` no SQL Editor do Supabase de produção. O worker funciona antes e depois dela, então a ordem entre a migração e o deploy não importa. Sem ela, ele avisa no log e segue, mas a conta da cota do YouTube e o prazo dos canais acompanhados recomeçam a cada reinício, e o banco aceita mais de 3.000 seguidos por conta (o worker acompanha só até `FOLLOWS_PER_ACCOUNT` do mesmo jeito).

**Plano free e monitor de uptime.** O serviço está no plano free: dorme depois de 15 min sem acesso, leva cerca de 1 min para acordar e pode reiniciar a qualquer hora. As 750 h por mês do plano são por workspace; mantenha este como o único serviço free dele, porque estourar suspende todos os serviços free até o mês seguinte.

- O que o mantém acordado é um monitor de uptime que chama `https://api.multistreams.cyberhat.com.br/health` a cada 5 min. Anote aqui o serviço e a conta do monitor: **serviço:** _(preencher)_ · **conta:** _(preencher)_.
- Se o monitor parar, o worker dorme 15 min depois do último uso. Dormindo, ele não consulta nenhuma plataforma e não manda push: ninguém é avisado quando a live começa. O primeiro pedido leva cerca de 1 min para acordá-lo, mais que os 25 s que o app espera, então o aviso da tela Ao vivo mostra "SEM RESPOSTA" ("O servidor do Multistreams não respondeu agora.") até a consulta seguinte (60 s) ou o "Tentar agora". Nas versões até a 1.0.4, do APK e do site, o aviso é sempre "SEM CONEXAO". Ao acordar, a lista "tudo ao vivo" recomeça do zero (a varredura da Twitch leva alguns minutos).
- Para conferir: `/health` responde em poucos segundos a qualquer hora. Se demorar perto de 1 min, o serviço estava dormindo e o monitor parou.
- O plano starter acaba com o sono, mas é uma decisão de custo.

### Site e APK na Hostinger

`multistreams.cyberhat.com.br` é o site estático, com o APK em `/multistreams.apk`. Os dois saem do script `client/scripts/build-release.ps1`.

**Antes de gerar:**

- `client/.env` com os valores reais de `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` e `EXPO_PUBLIC_TWITCH_CLIENT_ID`. O script resolve as variáveis como o `expo export` (as do ambiente valem mais, depois `.env.production.local`, `.env.local`, `.env.production` e `.env`) e para se alguma estiver vazia. Valores só de produção podem ficar num `client/.env.production`. A URL do worker vem do próprio script.
- Só para o APK: a **mesma** chave que assinou os APKs publicados, em `%USERPROFILE%\multistreams-android-keystore\` (com outra chave, o Android recusa instalar por cima e quem já tem o app precisaria desinstalar), o Android SDK (Android Studio) e um JDK 17 (o script procura no `JAVA_HOME`, em `C:\Program Files\Java\jdk-17*`, `C:\Program Files\Eclipse Adoptium\jdk-17*` e `%USERPROFILE%\.jdks\jdk-17*`).
- APK novo: suba `expo.version` e `expo.android.versionCode` em `client/app.json`.

**Gerar** (PowerShell, em `client/`):

```powershell
$env:MULTISTREAMS_KEYSTORE_PASSWORD = '<senha do LEIA-ME.txt da chave>'
npm run release           # site + APK
npm run release:site      # só o site: não precisa de chave, JDK nem SDK e mantém o dist\multistreams.apk que já estiver lá
```

O script roda num processo à parte (`powershell -ExecutionPolicy Bypass -File .\scripts\build-release.ps1`), então `NODE_ENV`, `CI` e a URL de produção não ficam no terminal. Para gerar sem login de propósito: `npm run release -- -SemConta`. No fim ele mostra a URL do worker, se o Supabase entrou, o commit e o APK, e grava o mesmo em `dist/version.json`:

```json
{ "site": { "commit": "ea3eccc", "dirty": false, "builtAt": "…", "api": "https://api.multistreams.cyberhat.com.br", "supabase": true },
  "apk": { "version": "1.0.5", "versionCode": 6, "commit": "ea3eccc", "builtAt": "…" } }
```

Com `release:site`, `apk` repete o que o `version.json` anterior dizia do APK mantido (ou `null`, se não havia).

**Subir:**

1. Troque o conteúdo de `public_html` pelo **conteúdo** de `client/dist/`, inclusive o `.htaccess` (no gerenciador de arquivos da Hostinger, ligue a opção de mostrar arquivos ocultos). Se o `dist/` não tiver o `multistreams.apk` (por exemplo, `release:site` num clone novo), não apague o APK que está no servidor.
2. Limpe o cache do CDN da Hostinger no hPanel. O APK tem sempre o mesmo nome e fica preso no cache.

**Conferir o conteúdo, não só o status.** O servidor já respondeu 200 com o próprio site para arquivos que faltavam, e foi assim que o site ficou na 1.0.0 sem ninguém notar:

```powershell
curl.exe -s https://multistreams.cyberhat.com.br/version.json        # o commit do resumo e, com APK novo, o versionCode
curl.exe -sI https://multistreams.cyberhat.com.br/robots.txt         # Content-Type: text/plain
curl.exe -sI https://multistreams.cyberhat.com.br/og-image.jpg       # Content-Type: image/jpeg
curl.exe -sI https://multistreams.cyberhat.com.br/multistreams.apk   # Content-Length igual ao do dist\multistreams.apk
curl.exe -sI https://multistreams.cyberhat.com.br/nao-existe.txt     # 404
```

O `.htaccess` manda HSTS de 1 dia (`max-age=86400`). Depois de conferir tudo em https, suba para `max-age=31536000`.

A chave que assina o APK fica fora do projeto, em `%USERPROFILE%\multistreams-android-keystore\`. Guarde uma cópia: sem ela não dá para publicar atualizações do app.

### Push no Android

O push depende de duas coisas que o app ainda não tem: o `projectId` do EAS e o Firebase. O APK continua saindo do `npm run release` (prebuild e Gradle locais); não precisa de EAS Build.

1. **Projeto no EAS:** em `client/`, rode `npx eas-cli@latest login` e `npx eas-cli@latest init`. Ele cria o projeto no expo.dev e grava `extra.eas.projectId` e `owner` no `app.json`. Faça commit do `app.json`.
2. **Firebase:** em https://console.firebase.google.com, crie (ou use) um projeto e adicione um app Android com o pacote `br.com.cyberhat.multistreams`. Baixe o `google-services.json`, ponha em `client/google-services.json` e acrescente `"googleServicesFile": "./google-services.json"` em `expo.android` no `app.json`. Ele só tem identificadores públicos e pode ir para o repositório; o script de release já o copia junto com o resto do `client/`.
3. **Chave FCM V1 no EAS:** no Firebase, em *Configurações do projeto → Contas de serviço*, gere uma nova chave privada (JSON). Envie com `npx eas-cli@latest credentials` → Android → production → *Google Service Account* → *Manage your Google Service Account Key for Push Notifications (FCM V1)* → *Upload a new service account key*, ou pelo expo.dev em *Project settings → Credentials*. Essa chave é secreta: não a deixe no repositório.
4. Gere um APK novo (com `versionCode` maior), instale, entre com uma conta e aceite as notificações. A tabela `push_tokens` do Supabase deve ganhar uma linha. O `npm run release` avisa, no começo e no resumo, quando o `app.json` ainda não tem `projectId` ou `googleServicesFile`.

### Lojas

Ainda não usadas. O caminho é `eas build` e `eas submit`, e o identificador já é o definitivo: `br.com.cyberhat.multistreams`.

## Aba Ao vivo

Três modos, todos filtrados pelas línguas e plataformas marcadas (mínimo de uma de cada; na primeira vez só a língua do aparelho vem marcada):

- **Mais espectadores** (padrão) e **Menos espectadores**: lista infinita de quem está no ar (`GET /browse?sort=desc|asc&offset&limit` no worker, 50 por página). No celular, os botões aparecem como **Mais vistas** e **Menos vistas**, para caber em telas de 360 px.
- **Seguindo**: a lista do usuário, com a seção Offline e o botão "+ Adicionar streamer". Quem está ao vivo mas fora dos filtros de língua, plataforma ou categoria não some: aparece na seção "Fora dos filtros", com o motivo. A lista vem da importação (login com Twitch e Google) e dos canais adicionados por link. A Kick não tem API de seguidos, então os canais dela entram só pelo link.

**Categorias** (jogos, IRL, Just Chatting…): o painel lista as categorias de quem está ao vivo agora, com as plataformas e a soma de viewers (`GET /categories`). A mesma categoria em plataformas diferentes é juntada pelo nome ("Grand Theft Auto V (GTA)" na Kick = "Grand Theft Auto V" na Twitch). Nenhuma marcada = todas. No YouTube as categorias são as genéricas dele (Jogos, Entretenimento…), não o nome do jogo.

O que cada plataforma permite:

- **Twitch:** todas as lives. O worker varre a Get Streams página a página (em português são ~90 páginas, ~20 s) e refaz a varredura a cada 3 minutos enquanto alguém estiver usando. Durante a primeira varredura a lista vai crescendo.
- **Kick:** a API não pagina e devolve no máximo 100 lives por consulta. O worker pede as 100 maiores de cada língua e, de novo, as 100 maiores das 10 categorias mais fortes de cada língua (a lista geral da Kick deixa lives grandes de fora). Com categoria marcada, pede as 100 maiores daquela categoria.
- **YouTube:** não existe consulta de "todas as lives". O worker busca "ao vivo" (ou o equivalente) em cada língua, ~50 por língua, redescobertas a cada `BROWSE_YOUTUBE_MINUTES` (padrão 120) e dentro dos tetos diários de buscas e de unidades (ver [cota do YouTube](#1-worker)). É uma lista aproximada.

Por isso "Menos espectadores" só é completo na Twitch; na Kick e no YouTube só entram as lives que aparecem nessas consultas.

## Notas de API

- **Twitch:** Helix `Get Streams` (100 canais por chamada, a cada 60s) + EventSub opcional.
- **YouTube:** feed RSS do canal (sem cota) para achar vídeos recentes e `videos.list` (1 unidade por 50 vídeos) só para os que ainda podem estar ao vivo. A busca tenta o `@handle` (1 unidade) antes de cair no `search.list` (1 das 100 buscas do dia). Sem buscas sobrando, só o `@handle` e o link do canal funcionam.
- **Kick:** API pública oficial. Não tem busca por nome (só slug exato) nem número de seguidores.
- **Idioma:** se a plataforma não informa o idioma da live, vale o idioma cadastrado no streamer.
