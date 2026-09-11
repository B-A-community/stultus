# Собирает src\ в build\Stultus-<версия>.rbz. SketchUp читает stultus.rb из
# КОРНЯ архива, версию берём из src\stultus\constants.rb.
# Запуск:  powershell -ExecutionPolicy Bypass -File tools\build_rbz.ps1

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$src  = Join-Path $root 'src'
$out  = Join-Path $root 'build'

if (-not (Test-Path $src)) { throw "Нет папки с исходниками: $src" }

$constants = Join-Path $src 'stultus\constants.rb'
$match = Select-String -Path $constants -Pattern "VERSION\s*=\s*'([^']+)'" | Select-Object -First 1
if (-not $match) { throw "Не нашёл VERSION в $constants" }
$version = $match.Matches[0].Groups[1].Value

$name = "Stultus-$version.rbz"
$rbz  = Join-Path $out $name
New-Item -ItemType Directory -Force $out | Out-Null
if (Test-Path $rbz) { Remove-Item $rbz -Force }

# Записи добавляем поштучно: CreateFromDirectory и Compress-Archive в PS 5.1
# пишут пути через обратный слэш, а ZIP требует прямой — SketchUp такой
# архив разложит в один файл вместо папки.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open($rbz, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    $prefix = (Resolve-Path $src).Path.TrimEnd('\') + '\'
    Get-ChildItem $src -Recurse -File | Sort-Object FullName | ForEach-Object {
        $entryName = $_.FullName.Substring($prefix.Length).Replace('\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $archive, $_.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally {
    $archive.Dispose()
}

Write-Host "Собрано: $rbz"
$check = [System.IO.Compression.ZipFile]::OpenRead($rbz)
$check.Entries | ForEach-Object { Write-Host ("  {0,-45} {1,7} б" -f $_.FullName, $_.Length) }
$check.Dispose()
