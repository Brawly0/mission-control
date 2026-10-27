$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$installTarget = [IO.Path]::GetFullPath((Join-Path $workspace 'out\installer-lifecycle\app'))
if (-not $installTarget.StartsWith((Join-Path $workspace 'out\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe installer test target' }
$testData = Join-Path $env:APPDATA 'mission-control-install-check'
if ((Test-Path -LiteralPath $installTarget) -or (Test-Path -LiteralPath $testData)) { throw 'Installer fixture already exists; inspect it before rerunning' }
$version = (Get-Content -LiteralPath (Join-Path $workspace 'package.json') -Raw | ConvertFrom-Json).version
$oldInstaller = Join-Path $workspace 'out\install-check-old\MissionControlInstallCheck Setup 0.24.99.exe'
$newInstaller = Join-Path $workspace "out\install-check-new\MissionControlInstallCheck Setup $version.exe"
foreach ($file in @($oldInstaller, $newInstaller)) { if (-not (Test-Path -LiteralPath $file)) { throw "Missing installer: $file" } }
New-Item -ItemType Directory -Path $testData | Out-Null
$marker = Join-Path $testData 'store.json'
'{"notes":[{"title":"Preserve through upgrade and uninstall"}]}' | Set-Content -LiteralPath $marker -Encoding UTF8
$hash = (Get-FileHash -LiteralPath $marker -Algorithm SHA256).Hash
function Invoke-Installer([string] $file, [string[]] $arguments) {
  $process = Start-Process -FilePath $file -ArgumentList $arguments -WindowStyle Hidden -PassThru
  if (-not $process.WaitForExit(55000)) { throw "Installer timed out: $file" }
  if ($process.ExitCode -ne 0) { throw "Installer exit $($process.ExitCode): $file" }
}
Invoke-Installer $oldInstaller @('/S', "/D=$installTarget")
$exe = Join-Path $installTarget 'MissionControlInstallCheck.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw 'Clean install did not create executable' }
if ((Get-Item -LiteralPath $exe).VersionInfo.ProductVersion -notlike '0.24.99*') { throw 'Wrong initial installed version' }
Write-Output 'Installer: clean per-user installation passed'
Invoke-Installer $newInstaller @('/S', "/D=$installTarget")
if ((Get-Item -LiteralPath $exe).VersionInfo.ProductVersion -notlike "$version*") { throw 'Upgrade did not replace executable' }
if ((Get-FileHash -LiteralPath $marker -Algorithm SHA256).Hash -ne $hash) { throw 'Upgrade changed saved data' }
Write-Output 'Installer: upgrade replaced executable and preserved saved data'
$uninstaller = Get-ChildItem -LiteralPath $installTarget -Filter 'Uninstall*.exe' | Select-Object -First 1
if (-not $uninstaller) { throw 'No registered uninstaller installed' }
Invoke-Installer $uninstaller.FullName @('/S', "_?=$installTarget")
for ($attempt = 0; $attempt -lt 50 -and (Test-Path -LiteralPath $exe); $attempt++) { Start-Sleep -Milliseconds 100 }
if (Test-Path -LiteralPath $exe) { throw 'Uninstall left executable behind' }
if ((Get-FileHash -LiteralPath $marker -Algorithm SHA256).Hash -ne $hash) { throw 'Uninstall removed saved data' }
$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'MissionControlInstallCheck.lnk'
$startShortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'MissionControlInstallCheck.lnk'
if ((Test-Path -LiteralPath $desktopShortcut) -or (Test-Path -LiteralPath $startShortcut)) { throw 'Uninstall left a test shortcut behind' }
Remove-Item -LiteralPath $marker
if ((Get-ChildItem -LiteralPath $testData -Force).Count -eq 0) { Remove-Item -LiteralPath $testData }
Write-Output 'Installer lifecycle: PASS (isolated app identity; real installation left untouched)'
