# Копирует плагин в папку Plugins SketchUp для разработки.
# По умолчанию SketchUp 2024; для другой версии:  .\dev_install.ps1 -Version 2025
# После копирования перезапустите SketchUp (или в Ruby-консоли: load 'stultus.rb').
param([string]$Version = '2024')
$ErrorActionPreference = "Stop"

$plugins = Join-Path $env:APPDATA "SketchUp\SketchUp $Version\SketchUp\Plugins"
if (-not (Test-Path $plugins)) {
  Write-Error "Не найдена папка плагинов SketchUp ${Version}: $plugins"
}

$target = Join-Path $plugins "stultus"
if (Test-Path $target) { Remove-Item $target -Recurse -Force }
Copy-Item (Join-Path $PSScriptRoot "src\stultus.rb") $plugins -Force
Copy-Item (Join-Path $PSScriptRoot "src\stultus") $plugins -Recurse -Force
Write-Host "Установлено в $plugins"
