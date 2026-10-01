# Gera o site (pasta dist/) e o APK assinado (dist/multistreams.apk), prontos para subir na Hostinger.
#
# Uso (PowerShell, dentro de client/):
#   $env:MULTISTREAMS_KEYSTORE_PASSWORD = '<senha do LEIA-ME.txt da chave>'
#   powershell -ExecutionPolicy Bypass -File .\scripts\build-release.ps1
#
# Requisitos: Android SDK (Android Studio) e um JDK 17 em %USERPROFILE%\.jdks\jdk-17*.
#
# Por que a cópia e o atalho: com espaço no caminho ("Vinicius Costa"), o CMake chama o compilador
# pelo nome curto do Windows (CLANG_~1.EXE) e o C++ não é ligado. Por isso o Android é compilado numa
# cópia em C:\ms-build e o SDK é acessado por C:\android-sdk (um atalho de pasta, nada é movido).

param(
  [string]$ApiUrl = 'https://api.multistreams.cyberhat.com.br',
  [string]$Keystore = "$env:USERPROFILE\multistreams-android-keystore\multistreams.jks",
  [string]$BuildDir = 'C:\ms-build\client',
  [string]$SdkLink = 'C:\android-sdk'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

if (-not $env:MULTISTREAMS_KEYSTORE_PASSWORD) { throw 'Defina $env:MULTISTREAMS_KEYSTORE_PASSWORD com a senha da chave do APK.' }
if (-not (Test-Path $Keystore)) { throw "Chave do APK não encontrada em $Keystore" }
$jdk = Get-ChildItem "$env:USERPROFILE\.jdks" -Directory -Filter 'jdk-17*' | Select-Object -First 1
if (-not $jdk) { throw 'JDK 17 não encontrado em %USERPROFILE%\.jdks' }
if (-not (Test-Path $SdkLink)) { New-Item -ItemType Junction -Path $SdkLink -Target "$env:LOCALAPPDATA\Android\Sdk" | Out-Null }

$env:JAVA_HOME = $jdk.FullName
$env:PATH = "$($jdk.FullName)\bin;$env:PATH"
$env:ANDROID_HOME = $SdkLink
$env:ANDROID_SDK_ROOT = $SdkLink
$env:EXPO_PUBLIC_API_URL = $ApiUrl   # vale mais que o client/.env (que aponta para o localhost)
$env:NODE_ENV = 'production'
$env:CI = '1'

Write-Host "== Site (servidor: $ApiUrl)"
npx.cmd expo export --platform web --output-dir dist --clear
if ($LASTEXITCODE) { throw 'falhou o build do site' }

# o .env vai junto: as chaves públicas do Supabase entram no APK (o endereço do worker vem da variável acima)
Write-Host "== Copiando o app para $BuildDir"
robocopy $root $BuildDir /MIR /XD "$root\android" "$root\ios" "$root\.expo" "$root\dist" /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw 'falhou a cópia' }

Write-Host '== APK'
Push-Location $BuildDir
npx.cmd expo prebuild --platform android --clean --no-install
if ($LASTEXITCODE) { Pop-Location; throw 'falhou o prebuild' }
Set-Content -Encoding ascii android\local.properties ('sdk.dir=' + ($SdkLink -replace '\\', '\\' -replace ':', '\:'))
Push-Location android
# só celulares de verdade (ARM): o APK fica bem menor que com x86
.\gradlew.bat assembleRelease --console=plain '-PreactNativeArchitectures=armeabi-v7a,arm64-v8a'
$code = $LASTEXITCODE
Pop-Location
Pop-Location
if ($code) { throw 'falhou o build do Android' }

$tools = Get-ChildItem "$SdkLink\build-tools" -Directory | Sort-Object { [version]($_.Name -replace '[^\d.]', '') } | Select-Object -Last 1
$rel = "$BuildDir\android\app\build\outputs\apk\release"
& "$($tools.FullName)\zipalign.exe" -f -p 4 "$rel\app-release.apk" "$rel\app-release-aligned.apk"
& "$($tools.FullName)\apksigner.bat" sign --ks $Keystore --ks-key-alias multistreams --ks-pass env:MULTISTREAMS_KEYSTORE_PASSWORD --key-pass env:MULTISTREAMS_KEYSTORE_PASSWORD --v4-signing-enabled false --out dist\multistreams.apk "$rel\app-release-aligned.apk"
if ($LASTEXITCODE) { throw 'falhou a assinatura do APK' }
& "$($tools.FullName)\apksigner.bat" verify dist\multistreams.apk
if ($LASTEXITCODE) { throw 'APK assinado não passou na verificação' }

$mb = [math]::Round((Get-Item dist\multistreams.apk).Length / 1MB, 1)
Write-Host "== Pronto: $root\dist (suba o CONTEÚDO desta pasta). APK: $mb MB"
