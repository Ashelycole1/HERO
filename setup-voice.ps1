# HERO Voice Stack Setup - 100% Free, Local, Offline
# Installs: Piper TTS + voice model, Whisper.cpp server, checks for Ollama
# Run: powershell -ExecutionPolicy Bypass -File setup-voice.ps1

$ErrorActionPreference = "Stop"
$VoiceDir = "$PSScriptRoot\voice"

Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "   HERO Voice Stack Setup - Free Forever Edition       " -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Create voice directory
if (-not (Test-Path $VoiceDir)) {
    New-Item -ItemType Directory -Path $VoiceDir | Out-Null
    Write-Host "[+] Created voice/ directory" -ForegroundColor Green
}
Set-Location $VoiceDir

# 2. Check / Install Ollama
Write-Host "`n[1/4] Checking Ollama (local LLM)..." -ForegroundColor Yellow
if (Get-Command ollama -ErrorAction SilentlyContinue) {
    Write-Host "  [OK] Ollama found: $(ollama --version 2>$null)" -ForegroundColor Green
} else {
    Write-Host "  Ollama not found. Downloading installer..." -ForegroundColor Yellow
    $ollamaInstaller = "$env:TEMP\OllamaSetup.exe"
    Invoke-WebRequest -Uri "https://ollama.com/download/OllamaSetup.exe" -OutFile $ollamaInstaller
    Write-Host "  Running Ollama installer (follow prompts)..." -ForegroundColor Yellow
    Start-Process $ollamaInstaller -Wait
    Write-Host "  [OK] Ollama installed. Restart this script after installation completes." -ForegroundColor Green
}

# Pull a conversational model if Ollama is running
$ollamaRunning = $false
try {
    $health = Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -TimeoutSec 3 -ErrorAction Stop
    $ollamaRunning = $true
    Write-Host "  [OK] Ollama server is running" -ForegroundColor Green
    $models = $health.models | ForEach-Object { $_.name }
    if ($models -notcontains "llama3.2" -and $models -notcontains "llama3.2:latest") {
        Write-Host "  Pulling llama3.2 (recommended 2B conversational model)..." -ForegroundColor Yellow
        Write-Host "  (This downloads 1.5GB - you can Ctrl+C and do it later with: ollama pull llama3.2)" -ForegroundColor DarkGray
        & ollama pull llama3.2
        Write-Host "  [OK] llama3.2 ready" -ForegroundColor Green
    } else {
        Write-Host "  [OK] llama3.2 already available" -ForegroundColor Green
    }
} catch {
    Write-Host "  [!] Ollama server not running. Start it with: ollama serve" -ForegroundColor Yellow
    Write-Host "      Then run: ollama pull llama3.2" -ForegroundColor DarkGray
}

# 3. Download Piper TTS
Write-Host "`n[2/4] Installing Piper TTS..." -ForegroundColor Yellow
$piperDir = "$VoiceDir\piper"
$piperExe = "$piperDir\piper.exe"

if (-not (Test-Path $piperExe)) {
    $piperZip = "$VoiceDir\piper_windows.zip"
    Write-Host "  Downloading Piper for Windows..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri "https://github.com/rhasspy/piper/releases/download/v1.2.0/piper_windows_amd64.zip" -OutFile $piperZip
    Expand-Archive -Path $piperZip -DestinationPath $piperDir -Force
    Remove-Item $piperZip -Force
    Write-Host "  [OK] Piper extracted to voice\piper\" -ForegroundColor Green
} else {
    Write-Host "  [OK] Piper already installed" -ForegroundColor Green
}

# Download voice model (en_US-lessac-medium - sounds very natural)
$modelDir  = "$piperDir\models"
$modelOnnx = "$modelDir\en_US-lessac-medium.onnx"
$modelJson = "$modelDir\en_US-lessac-medium.onnx.json"

if (-not (Test-Path $modelDir)) { New-Item -ItemType Directory -Path $modelDir | Out-Null }

if (-not (Test-Path $modelOnnx)) {
    $hfBase = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium"
    Write-Host "  Downloading en_US-lessac-medium voice model (~60MB)..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri "$hfBase/en_US-lessac-medium.onnx" -OutFile $modelOnnx
    Invoke-WebRequest -Uri "$hfBase/en_US-lessac-medium.onnx.json" -OutFile $modelJson
    Write-Host "  [OK] Voice model ready" -ForegroundColor Green
} else {
    Write-Host "  [OK] Voice model already downloaded" -ForegroundColor Green
}

# 4. Download Whisper.cpp
Write-Host "`n[3/4] Installing Whisper.cpp (local STT)..." -ForegroundColor Yellow
$whisperDir = "$VoiceDir\whisper"
$whisperExe = "$whisperDir\whisper-server.exe"

if (-not (Test-Path $whisperExe)) {
    Write-Host "  Downloading whisper.cpp pre-built server for Windows..." -ForegroundColor Yellow
    $whisperZip = "$VoiceDir\whisper_win.zip"
    Invoke-WebRequest `
        -Uri "https://github.com/ggerganov/whisper.cpp/releases/download/v1.6.0/whisper-server-win-x64.zip" `
        -OutFile $whisperZip
    Expand-Archive -Path $whisperZip -DestinationPath $whisperDir -Force
    Remove-Item $whisperZip -Force
    Write-Host "  [OK] whisper.cpp extracted to voice\whisper\" -ForegroundColor Green
} else {
    Write-Host "  [OK] whisper.cpp already installed" -ForegroundColor Green
}

# Download base English model (~140MB - fast, accurate)
$whisperModels = "$whisperDir\models"
if (-not (Test-Path $whisperModels)) { New-Item -ItemType Directory -Path $whisperModels | Out-Null }
$ggmlModel = "$whisperModels\ggml-base.en.bin"

if (-not (Test-Path $ggmlModel)) {
    Write-Host "  Downloading Whisper base.en model (~140MB)..." -ForegroundColor Yellow
    Invoke-WebRequest `
        -Uri "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin" `
        -OutFile $ggmlModel
    Write-Host "  [OK] Whisper model ready" -ForegroundColor Green
} else {
    Write-Host "  [OK] Whisper model already downloaded" -ForegroundColor Green
}

# 5. Write .env paths
Write-Host "`n[4/4] Updating .env configuration..." -ForegroundColor Yellow
$envFile = "$PSScriptRoot\.env"
$piperModelPath = "$piperDir\models\en_US-lessac-medium.onnx"

# Update or append each key
function Set-EnvKey($file, $key, $value) {
    $content = Get-Content $file -Raw
    if ($content -match "(?m)^$key=") {
        $content = $content -replace "(?m)^$key=.*", "$key=$value"
    } else {
        $content = $content.TrimEnd() + "`n$key=$value`n"
    }
    Set-Content $file $content
}

Set-EnvKey $envFile "OLLAMA_BASE_URL"    "http://localhost:11434"
Set-EnvKey $envFile "OLLAMA_MODEL"       "llama3.2"
Set-EnvKey $envFile "PIPER_EXE"          $piperExe.Replace("\","\\")
Set-EnvKey $envFile "PIPER_MODEL"        $piperModelPath.Replace("\","\\")
Set-EnvKey $envFile "WHISPER_SERVER_URL" "http://localhost:8765"

Write-Host "  [OK] .env updated" -ForegroundColor Green

# 6. Create start-voice-servers.ps1 helper
$startScript = @"
# Start Whisper.cpp STT server (port 8765) + ensure Ollama is running
Start-Process -NoNewWindow -FilePath "$whisperExe" -ArgumentList "-m `"$ggmlModel`" --port 8765 -l en" -PassThru
Write-Host "Whisper server started on :8765"

# Make sure Ollama is serving
if (-not (Invoke-RestMethod -Uri 'http://localhost:11434' -TimeoutSec 2 -ErrorAction SilentlyContinue)) {
    Start-Process ollama -ArgumentList "serve" -NoNewWindow
    Write-Host "Ollama server started on :11434"
} else {
    Write-Host "Ollama already running"
}
"@
Set-Content "$PSScriptRoot\start-voice-servers.ps1" $startScript

Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "   Setup Complete! Next steps:                        " -ForegroundColor Cyan
Write-Host "   1. Run: .\start-voice-servers.ps1                  " -ForegroundColor White
Write-Host "   2. Run: npm start  (from HERO root directory)      " -ForegroundColor White
Write-Host "   3. Open: http://localhost:5174                      " -ForegroundColor White
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""
