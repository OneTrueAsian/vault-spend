<#
.SYNOPSIS
  Clears Cargo's incremental-compilation cache once it grows past a size limit.

.DESCRIPTION
  target\debug\incremental only speeds up rebuilding this project's own crates; clearing it never
  changes what gets built, and Cargo recreates it on the next build. It collects stale copies over
  weeks (60 GB by 2026-10-12), so this trims it only when it passes the limit.

  It refuses to delete while a build, test run or the app could be using it (cargo, rustc, tauri,
  vaultspend or the e2e drivers), so it is safe to run between sessions, not during one.

.PARAMETER LimitGB
  Clear the cache when it is larger than this. Default 10.

.PARAMETER Path
  The incremental folder. Default: target\debug\incremental next to this script's repository.

.PARAMETER WhatIf
  Report what would happen without deleting anything.

.EXAMPLE
  .\tools\trim-incremental.ps1
  .\tools\trim-incremental.ps1 -LimitGB 5 -WhatIf
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [double]$LimitGB = 10,
  [string]$Path = (Join-Path $PSScriptRoot '..\target\debug\incremental')
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Path)) {
  Write-Host "Nothing to trim: $Path does not exist."
  return
}

$resolved = (Resolve-Path -LiteralPath $Path).Path
# Guard against a wrong -Path deleting something else: it must be a folder named "incremental".
if ((Split-Path -Leaf $resolved) -ne 'incremental') {
  throw "Refusing to clear '$resolved': the folder must be named 'incremental'."
}

$bytes = (Get-ChildItem -LiteralPath $resolved -Recurse -Force -File -ErrorAction SilentlyContinue |
    Measure-Object Length -Sum).Sum
$sizeGB = [math]::Round(([double]$bytes) / 1GB, 2)

if ($sizeGB -le $LimitGB) {
  Write-Host "Incremental cache is $sizeGB GB (limit $LimitGB GB). Leaving it alone."
  return
}

$busy = Get-Process -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match '^(cargo|rustc|link|tauri|tauri-driver|msedgedriver|vaultspend)$' }
if ($busy) {
  $names = ($busy | Select-Object -ExpandProperty Name -Unique) -join ', '
  Write-Warning "Incremental cache is $sizeGB GB (limit $LimitGB GB) but $names is running. Not clearing; run this again when it has finished."
  return
}

if ($PSCmdlet.ShouldProcess($resolved, "Delete $sizeGB GB of incremental cache")) {
  Remove-Item -LiteralPath $resolved -Recurse -Force
  Write-Host "Cleared $sizeGB GB from $resolved. The next build recreates it."
}
