param(
    [ValidateRange(1024, 65535)][int]$Port = 8080,
    [string]$PhpExecutable = 'php'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$phpCommand = Get-Command $PhpExecutable -ErrorAction SilentlyContinue
if (-not $phpCommand -and $PhpExecutable -eq 'php') {
    $runtimeRoot = Join-Path $env:LOCALAPPDATA 'DianaSite/runtime'
    if (Test-Path -LiteralPath $runtimeRoot) {
        $candidate = Get-ChildItem -LiteralPath $runtimeRoot -Filter php.exe -File -Recurse |
            Sort-Object FullName -Descending | Select-Object -First 1
        if ($candidate) { $PhpExecutable = $candidate.FullName; $phpCommand = Get-Command $PhpExecutable }
    }
}
if (-not $phpCommand) { throw 'PHP is not available. Pass -PhpExecutable with the path to PHP 8.1+.' }

$previewName = 'preview-' + $Port + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$privateDirectory = Join-Path (Join-Path $env:LOCALAPPDATA 'DianaSite') $previewName
New-Item -ItemType Directory -Path $privateDirectory -Force | Out-Null
$secretBytes = New-Object byte[] 32
$random = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $random.GetBytes($secretBytes) } finally { $random.Dispose() }
$secret = -join ($secretBytes | ForEach-Object { $_.ToString('x2') })
$origin = 'http://127.0.0.1:' + $Port
$configuration = @{
    storage_path = Join-Path $privateDirectory 'storage'
    secret = $secret
    allowed_origins = @($origin)
    notification_email = 'dianagulchenko@yandex.ru'
    from_email = 'no-reply@dianaberezovskaya.online'
    mail_enabled = $false
    retention_days = 90
    rate_limit = 20
    rate_window_seconds = 900
} | ConvertTo-Json -Compress
$encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($configuration))
$configFile = Join-Path $privateDirectory 'config.php'
$utf8 = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText($configFile, "<?php`nreturn json_decode(base64_decode('$encoded'), true, 512, JSON_THROW_ON_ERROR);`n", $utf8)
$previousConfig = $env:DIANA_CONFIG_PATH
try {
    $env:DIANA_CONFIG_PATH = $configFile
    Write-Host "Preview: $origin"
    Write-Host 'Use test contacts. Outbound email is disabled. Stop with Ctrl+C.'
    & $phpCommand.Source -n -d display_errors=0 -d log_errors=1 -S ('127.0.0.1:' + $Port) -t $projectRoot (Join-Path $PSScriptRoot 'dev-router.php')
} finally {
    $env:DIANA_CONFIG_PATH = $previousConfig
}
