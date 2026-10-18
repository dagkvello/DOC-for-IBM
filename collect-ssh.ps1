<#
.SYNOPSIS
  Collect FlashSystem inventory over SSH and build the DOC wiki.

.DESCRIPTION
  Use this when TCP 7443 is blocked and only SSH (22) and HTTPS (443) are open.
  When 7443 is reachable, use discover/discover.js instead.
  Works for one installed system or several. Customer name and contacts stay in config.overrides.yaml.

.PARAMETER Hosts
  Management IPs or DNS names, comma-separated.

.PARAMETER User
  FlashSystem user with the monitor role and SSH login.

.PARAMETER SkipWiki
  Write the YAML only. Do not run build-wiki.js.

.EXAMPLE
  .\collect-ssh.ps1 -User monitor -Hosts 10.1.1.1,10.2.2.2
#>
[CmdletBinding()]
param(
  [string] $Hosts,
  [string] $User,
  [switch] $SkipWiki
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js is not on PATH.'
}
if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
  throw 'ssh is not on PATH. Install the Windows OpenSSH client (8.4 or newer).'
}

if (-not $Hosts) { $Hosts = $env:FS_HOSTS }
if (-not $Hosts) { $Hosts = Read-Host 'Management IPs or names, comma-separated' }
$hostList = @($Hosts -split '[,;\s]+' | Where-Object { $_ })
if (-not $hostList.Count) { throw 'No management addresses.' }

if (-not $User) { $User = $env:FS_USER }
if (-not $User) { $User = Read-Host 'FlashSystem user' }
if (-not $User) { throw 'No user.' }

$sec = Read-Host "Password for $User" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
try {
  $env:FS_PASS = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  $env:FS_USER = $User

  $raw = @(& node discover/ssh-collect.js --hosts ($hostList -join ',') --user $User --dump-json discover/dump)
  if ($LASTEXITCODE -ne 0) { throw "SSH collect failed ($LASTEXITCODE)" }

  $line = @($raw | Where-Object { $_ -match '"snapshots"' } | Select-Object -Last 1)
  if (-not $line) { throw 'SSH collect did not report snapshot files.' }
  $paths = @((($line | ConvertFrom-Json).snapshots))
  if (-not $paths.Count) { throw 'No snapshot files were written.' }

  $jsonArgs = @()
  foreach ($p in $paths) {
    $jsonArgs += '--json'
    $jsonArgs += $p
  }
  & node discover/discover.js @jsonArgs --write-generated
  if ($LASTEXITCODE -ne 0) { throw "discover failed ($LASTEXITCODE)" }

  if (-not $SkipWiki) {
    & node build-wiki.js --generated
    if ($LASTEXITCODE -ne 0) { throw "build-wiki failed ($LASTEXITCODE)" }
  }
}
finally {
  if ($bstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
  $env:FS_PASS = $null
  $env:FS_USER = $null
}
