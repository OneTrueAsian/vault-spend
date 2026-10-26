param(
    [Parameter(Mandatory)][string]$Edge,
    [Parameter(Mandatory)][string]$Driver
)

# The native Edge driver only starts a session for the exact Edge version it was built for. Edge can update
# itself after the driver was downloaded; fail with that reason before a spec spends its time on it.
$ErrorActionPreference = 'Stop'
$version = (Get-Item -LiteralPath $Edge).VersionInfo.ProductVersion
$reported = & $Driver --version
if ($LASTEXITCODE -ne 0) { throw "Native Edge driver could not report its version (exit $LASTEXITCODE)" }
if ($reported -notmatch [regex]::Escape($version)) {
    throw "Native Edge driver ($reported) no longer matches installed Edge $version; Edge updated after the driver was installed"
}
Write-Host "Native Edge driver matches Edge ${version}: $reported"
