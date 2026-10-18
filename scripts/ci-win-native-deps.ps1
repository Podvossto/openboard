# Install the Windows native optional deps pinned in package-lock.json.
# Works around npm/cli#4828: a lockfile generated on Linux can make `npm ci` on Windows
# skip platform-specific optional packages (rolldown, lightningcss, tauri-cli bindings).
# Lockfile is parsed with node (PowerShell 5.1 ConvertFrom-Json rejects the "" root key).
$pkgs = node -e "const p=require('./package-lock.json').packages;const s=new Set();for(const [k,v] of Object.entries(p)){if(k.endsWith('win32-x64-msvc'))s.add(k.replace(/^.*node_modules\//,'')+'@'+v.version)}console.log([...s].join(' '))"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$list = $pkgs -split ' ' | Where-Object { $_ }
Write-Host "Installing native deps -> $($list -join ', ')"
if ($list.Count -eq 0) { exit 0 }
npm install --no-save @list
exit $LASTEXITCODE
