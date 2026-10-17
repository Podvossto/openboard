# Install the Windows native optional deps pinned in package-lock.json.
# Works around npm/cli#4828: a lockfile generated on Linux can make `npm ci` on Windows
# skip platform-specific optional packages (rolldown, lightningcss, tauri-cli bindings).
$ErrorActionPreference = "Stop"
$lock = Get-Content package-lock.json -Raw | ConvertFrom-Json
$pkgs = $lock.packages.PSObject.Properties |
  Where-Object { $_.Name -like '*win32-x64-msvc' } |
  ForEach-Object { ($_.Name -replace '^.*node_modules/', '') + '@' + $_.Value.version } |
  Sort-Object -Unique
Write-Host "Installing native deps -> $($pkgs -join ', ')"
npm install --no-save @pkgs
exit $LASTEXITCODE
