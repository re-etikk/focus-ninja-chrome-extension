param(
  [string]$ExtensionPath = (Join-Path $PSScriptRoot "dist")
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $ExtensionPath)) {
  Write-Host "dist/ folder nahi mila. Pehle 'npm install' aur 'npm run build' chalao." -ForegroundColor Yellow
  exit 1
}

$browserPaths = @(
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "$env:PROGRAMFILES\Google\Chrome\Application\chrome.exe",
  "$env:PROGRAMFILES(X86)\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe",
  "$env:PROGRAMFILES\Microsoft\Edge\Application\msedge.exe",
  "$env:PROGRAMFILES(X86)\Microsoft\Edge\Application\msedge.exe"
)

$browserPath = $browserPaths | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $browserPath) {
  Write-Host "Chrome ya Edge install nahi hai. Pehle browser install karo aur phir yeh script dubara chalao." -ForegroundColor Yellow
  exit 1
}

$resolvedPath = (Resolve-Path $ExtensionPath).Path
$browserName = if ($browserPath -match 'msedge') { 'Edge' } else { 'Chrome' }

Write-Host "Opening $browserName with the built extension loaded from $resolvedPath..." -ForegroundColor Green
Start-Process -FilePath $browserPath -ArgumentList @("--load-extension=$resolvedPath", "--new-window", "chrome://extensions/")

Write-Host "Agar browser khul jaaye to Extensions page par Developer mode on karo aur extension ko enable karo." -ForegroundColor Cyan
