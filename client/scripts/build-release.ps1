# Gera o site (pasta dist/) e o APK assinado (dist/multistreams.apk), prontos para subir na Hostinger.
#
# Uso (dentro de client/):
#   $env:MULTISTREAMS_KEYSTORE_PASSWORD = '<senha do LEIA-ME.txt da chave>'
#   npm run release          (o mesmo que: powershell -ExecutionPolicy Bypass -File .\scripts\build-release.ps1)
#   npm run release:site     (só o site, mantendo o APK que já está em dist/; o mesmo que -SoSite)
#   -SemConta                gera mesmo sem Supabase e Client ID da Twitch: site e APK sem login, de propósito
#
# Antes de exportar, o script resolve as variáveis do app como o expo export resolve e para se faltar o
# Supabase ou o Client ID da Twitch. Depois confere o JavaScript gerado, grava dist/version.json (commit do
# site e, com APK novo, version e versionCode) e termina com um resumo. As variáveis de ambiente e a pasta
# atual voltam ao que eram no fim, mesmo com erro.
#
# Requisitos, só para o APK: a chave em %USERPROFILE%\multistreams-android-keystore, o Android SDK (Android
# Studio) e um JDK 17 (JAVA_HOME, C:\Program Files\Java, C:\Program Files\Eclipse Adoptium ou %USERPROFILE%\.jdks).
#
# Por que a cópia e o atalho: com espaço no caminho ("Vinicius Costa"), o CMake chama o compilador
# pelo nome curto do Windows (CLANG_~1.EXE) e o C++ não é ligado. Por isso o Android é compilado numa
# cópia em C:\ms-build e o SDK é acessado por C:\android-sdk (um atalho de pasta, nada é movido).

[CmdletBinding()]  # um parâmetro digitado errado dá erro, em vez de rodar o build completo
param(
  [string]$ApiUrl = 'https://api.multistreams.cyberhat.com.br',
  [string]$Keystore = "$env:USERPROFILE\multistreams-android-keystore\multistreams.jks",
  [string]$BuildDir = 'C:\ms-build\client',
  [string]$SdkLink = 'C:\android-sdk',
  [switch]$SoSite,
  [switch]$SemConta
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

# JDK 17: o do JAVA_HOME, se for 17, ou o primeiro achado nas pastas de instalação comuns
function Find-Jdk17 {
  if ($env:JAVA_HOME -and (Test-Path "$env:JAVA_HOME\bin\java.exe") -and
      (Select-String -Path "$env:JAVA_HOME\release" -Pattern '^JAVA_VERSION="17[."]' -Quiet -ErrorAction SilentlyContinue)) {
    return $env:JAVA_HOME
  }
  foreach ($dir in "$env:ProgramFiles\Java", "$env:ProgramFiles\Eclipse Adoptium", "$env:USERPROFILE\.jdks") {
    $jdk = Get-ChildItem $dir -Directory -Filter 'jdk-17*' -ErrorAction SilentlyContinue |
      Where-Object { Test-Path "$($_.FullName)\bin\java.exe" } | Select-Object -First 1
    if ($jdk) { return $jdk.FullName }
  }
}

# commit do código do app (client/) e se havia mudança sem commit
function Get-Commit {
  $ErrorActionPreference = 'Continue'  # o git escreve no stderr quando não há repositório
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { return @{ sha = $null; dirty = $null } }
  $sha = git rev-parse --short HEAD 2>$null
  if ($LASTEXITCODE) { return @{ sha = $null; dirty = $null } }
  $changes = git status --porcelain -- . 2>$null
  return @{ sha = "$sha".Trim(); dirty = [bool]$changes }
}

function Get-Now { (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", [Globalization.CultureInfo]::InvariantCulture) }

# dist/version.json: o que está no ar (o .htaccess o serve sem cache)
function Write-Version($site, $apk) {
  $json = [ordered]@{ site = $site; apk = $apk } | ConvertTo-Json -Depth 4
  [IO.File]::WriteAllText("$root\dist\version.json", $json, (New-Object Text.UTF8Encoding $false))
}

# o script muda estas variáveis e a pasta atual; tudo volta ao que era no fim, mesmo com erro
$envNames = 'JAVA_HOME', 'PATH', 'ANDROID_HOME', 'ANDROID_SDK_ROOT', 'EXPO_PUBLIC_API_URL', 'NODE_ENV', 'CI', 'JAVA_TOOL_OPTIONS'
$envBefore = @{}
foreach ($n in $envNames) { $envBefore[$n] = [Environment]::GetEnvironmentVariable($n, 'Process') }
$apkTmp = Join-Path $env:TEMP 'multistreams-apk-backup.apk'
$backedUp = $false
Push-Location $root
try {
  # o que só o APK usa é conferido antes do export, que apaga o dist/
  if (-not $SoSite) {
    if (-not $env:MULTISTREAMS_KEYSTORE_PASSWORD) { throw 'Defina $env:MULTISTREAMS_KEYSTORE_PASSWORD com a senha da chave do APK (ou use -SoSite para gerar só o site).' }
    if (-not (Test-Path $Keystore)) { throw "Chave do APK não encontrada em $Keystore (ou use -SoSite para gerar só o site)." }
    $jdk = Find-Jdk17
    if (-not $jdk) { throw 'JDK 17 não encontrado no JAVA_HOME, em C:\Program Files\Java\jdk-17*, C:\Program Files\Eclipse Adoptium\jdk-17* nem em %USERPROFILE%\.jdks\jdk-17*. Instale um JDK 17 (ou use -SoSite para gerar só o site).' }
    if (-not (Test-Path $SdkLink)) {
      $sdk = "$env:LOCALAPPDATA\Android\Sdk"
      if (-not (Test-Path $sdk)) { throw "Android SDK não encontrado em $sdk. Instale pelo Android Studio (ou use -SoSite para gerar só o site)." }
      New-Item -ItemType Junction -Path $SdkLink -Target $sdk | Out-Null
    }
    $env:JAVA_HOME = $jdk
    $env:PATH = "$jdk\bin;$env:PATH"
    $env:ANDROID_HOME = $SdkLink
    $env:ANDROID_SDK_ROOT = $SdkLink
    # o Java 17 abre um socket local (AF_UNIX) na pasta temporária; com o nome curto do Windows
    # (C:\Users\VINICI~1\...) a conexão falha ("Unable to establish loopback connection") e o Gradle não sobe
    $javaTmp = Join-Path (Split-Path $BuildDir -Parent) 'tmp'
    New-Item -ItemType Directory -Force $javaTmp | Out-Null
    $env:JAVA_TOOL_OPTIONS = "-Djdk.net.unixdomain.tmpdir=$javaTmp"
  }
  $env:EXPO_PUBLIC_API_URL = $ApiUrl   # vale mais que o client/.env (que aponta para o localhost)
  $env:NODE_ENV = 'production'
  $env:CI = '1'

  # as variáveis como o expo export resolve: as do ambiente valem mais, e com NODE_ENV=production
  # entram .env.production.local, .env.local, .env.production e .env (o APK usa os mesmos arquivos)
  $js = "const r = require('@expo/env').loadProjectEnv(process.cwd(), { mode: 'production', silent: true, force: true }); " +
    "const k = ['EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY', 'EXPO_PUBLIC_TWITCH_CLIENT_ID']; " +
    "console.log(JSON.stringify({ files: (r.files || []).map(f => require('path').basename(f)), env: Object.fromEntries(k.map(x => [x, process.env[x] || ''])) }))"
  $resolved = node -e $js | ConvertFrom-Json
  if ($LASTEXITCODE -or -not $resolved) { throw 'Não deu para ler as variáveis do app (node e @expo/env, em client/node_modules).' }
  $vars = $resolved.env
  $api = $vars.EXPO_PUBLIC_API_URL
  $falta = @('EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY', 'EXPO_PUBLIC_TWITCH_CLIENT_ID') | Where-Object { [string]::IsNullOrWhiteSpace($vars.$_) }
  if ($falta -and -not $SemConta) {
    throw "Vazio no build: $($falta -join ', '). Sem isso o site e o APK saem sem login, sincronização e importação. Preencha o client/.env (ou um .env.production) com os valores do projeto; para gerar assim de propósito, use -SemConta."
  }
  $comConta = -not [string]::IsNullOrWhiteSpace($vars.EXPO_PUBLIC_SUPABASE_URL) -and -not [string]::IsNullOrWhiteSpace($vars.EXPO_PUBLIC_SUPABASE_ANON_KEY)
  $supabaseHost = $null
  if ($comConta) {
    $u = $null
    if (-not [Uri]::TryCreate($vars.EXPO_PUBLIC_SUPABASE_URL, [UriKind]::Absolute, [ref]$u)) { throw "EXPO_PUBLIC_SUPABASE_URL não é uma URL: $($vars.EXPO_PUBLIC_SUPABASE_URL)" }
    $supabaseHost = $u.Host
  }
  $app = (Get-Content app.json -Raw -Encoding UTF8 | ConvertFrom-Json).expo
  $git = Get-Commit
  $files = if ($resolved.files) { $resolved.files -join ', ' } else { 'nenhum .env' }

  # o export apaga a pasta dist inteira: guarda o APK e o que o version.json dizia dele
  $apkInfo = $null
  if (Test-Path dist\multistreams.apk) {
    Copy-Item dist\multistreams.apk $apkTmp -Force
    $backedUp = $true
    try { $apkInfo = (Get-Content dist\version.json -Raw -Encoding UTF8 | ConvertFrom-Json).apk } catch { $apkInfo = $null }
  } elseif (Test-Path $apkTmp) {
    Write-Warning "Há um APK guardado de uma execução interrompida em $apkTmp; ele não volta sozinho para o dist\."
  }
  if (-not $SoSite -and $apkInfo -and [int]$apkInfo.versionCode -ge [int]$app.android.versionCode) {
    Write-Warning "O versionCode do app.json ($($app.android.versionCode)) não passa o do APK anterior ($($apkInfo.versionCode)). Suba version e versionCode antes de publicar."
  }
  $push = [bool]($app.extra.eas.projectId -and $app.android.googleServicesFile)
  $semPush = 'O APK sai sem push: falta extra.eas.projectId ou android.googleServicesFile no app.json (README, "Push no Android").'
  if (-not $SoSite -and -not $push) { Write-Warning $semPush }

  Write-Host "== Site (servidor: $api; variáveis de: $files)"
  npx.cmd expo export --platform web --output-dir dist --clear
  if ($LASTEXITCODE) { throw 'falhou o build do site' }

  # confere o que entrou no JavaScript do site, antes de seguir para o APK
  $bundle = Get-ChildItem dist\_expo\static\js -Recurse -Filter *.js -ErrorAction SilentlyContinue
  if (-not $bundle) { throw 'O export não gerou o JavaScript do site (dist\_expo\static\js).' }
  $code = ($bundle | ForEach-Object { [IO.File]::ReadAllText($_.FullName) }) -join "`n"
  if (-not $code.Contains($api.TrimEnd('/'))) { throw "O JavaScript do site não tem a URL do worker ($api)." }
  if ($comConta -and -not $code.Contains($supabaseHost)) { throw "O JavaScript do site não tem o Supabase ($supabaseHost)." }

  # o APK anterior volta para o dist/; no build completo, o novo o substitui no fim
  if ($backedUp) { Move-Item $apkTmp dist\multistreams.apk -Force; $backedUp = $false } else { $apkInfo = $null }
  $site = [ordered]@{ commit = $git.sha; dirty = $git.dirty; builtAt = (Get-Now); api = $api; supabase = $comConta }
  Write-Version $site $apkInfo

  if (-not $SoSite) {
    # o .env vai junto: as chaves públicas do Supabase entram no APK (o endereço do worker vem da variável acima)
    Write-Host "== Copiando o app para $BuildDir"
    robocopy $root $BuildDir /MIR /XD "$root\android" "$root\ios" "$root\.expo" "$root\dist" /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw 'falhou a cópia' }

    Write-Host '== APK'
    Push-Location $BuildDir
    try {
      npx.cmd expo prebuild --platform android --clean --no-install
      if ($LASTEXITCODE) { throw 'falhou o prebuild' }
      Set-Content -Encoding ascii android\local.properties ('sdk.dir=' + ($SdkLink -replace '\\', '\\' -replace ':', '\:'))
      Push-Location android
      try {
        # só celulares de verdade (ARM): o APK fica bem menor que com x86
        .\gradlew.bat assembleRelease --console=plain '-PreactNativeArchitectures=armeabi-v7a,arm64-v8a'
        if ($LASTEXITCODE) { throw 'falhou o build do Android' }
      } finally { Pop-Location }
    } finally { Pop-Location }

    $tools = Get-ChildItem "$SdkLink\build-tools" -Directory -ErrorAction SilentlyContinue | Sort-Object { [version]($_.Name -replace '[^\d.]', '') } | Select-Object -Last 1
    if (-not $tools) { throw "Nenhum build-tools em $SdkLink\build-tools (instale pelo SDK Manager do Android Studio)." }
    $rel = "$BuildDir\android\app\build\outputs\apk\release"
    & "$($tools.FullName)\zipalign.exe" -f -p 4 "$rel\app-release.apk" "$rel\app-release-aligned.apk"
    if ($LASTEXITCODE) { throw 'falhou o zipalign do APK' }
    # assina fora do dist/: o APK só entra lá depois de verificado
    & "$($tools.FullName)\apksigner.bat" sign --ks $Keystore --ks-key-alias multistreams --ks-pass env:MULTISTREAMS_KEYSTORE_PASSWORD --key-pass env:MULTISTREAMS_KEYSTORE_PASSWORD --v4-signing-enabled false --out "$rel\multistreams.apk" "$rel\app-release-aligned.apk"
    if ($LASTEXITCODE) { throw 'falhou a assinatura do APK' }
    & "$($tools.FullName)\apksigner.bat" verify "$rel\multistreams.apk"
    if ($LASTEXITCODE) { throw 'APK assinado não passou na verificação' }
    Copy-Item "$rel\multistreams.apk" dist\multistreams.apk -Force

    $apkInfo = [ordered]@{ version = $app.version; versionCode = $app.android.versionCode; commit = $git.sha; builtAt = (Get-Now) }
    Write-Version $site $apkInfo
  }

  # resumo: confira antes de subir
  $dirty = if ($git.dirty) { ' + mudanças sem commit' } else { '' }
  Write-Host ''
  Write-Host "== Pronto: $root\dist (suba o CONTEÚDO desta pasta, com o .htaccess)"
  Write-Host "   API do worker: $api"
  if ($comConta) { Write-Host "   Supabase: sim ($supabaseHost)" } else { Write-Warning 'Supabase: NÃO. Site e APK sem login, sincronização e importação (-SemConta).' }
  Write-Host "   Site: commit $(if ($git.sha) { $git.sha } else { 'desconhecido' })$dirty"
  if (-not $SoSite) {
    $mb = [math]::Round((Get-Item dist\multistreams.apk).Length / 1MB, 1)
    Write-Host "   APK novo: $($app.version) (versionCode $($app.android.versionCode)), $mb MB"
    if ($push) { Write-Host '   Push: configurado' } else { Write-Warning $semPush }
  } elseif (Test-Path dist\multistreams.apk) {
    $old = if ($apkInfo) { "$($apkInfo.version) (versionCode $($apkInfo.versionCode))" } else { 'versão desconhecida' }
    Write-Host "   APK: mantido o anterior, $old"
  } else {
    Write-Warning 'Não há multistreams.apk em dist\. Se subir assim, não apague o APK que já está no servidor.'
  }
} finally {
  # se o build parou entre o export e a volta do APK guardado, ele volta para o dist/
  if ($backedUp -and (Test-Path $apkTmp) -and -not (Test-Path "$root\dist\multistreams.apk")) {
    New-Item -ItemType Directory -Force "$root\dist" | Out-Null
    Move-Item $apkTmp "$root\dist\multistreams.apk" -Force
  }
  Pop-Location
  foreach ($n in $envNames) { [Environment]::SetEnvironmentVariable($n, $envBefore[$n], 'Process') }
}
