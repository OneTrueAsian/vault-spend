param([Parameter(Mandatory)][ValidateSet('smoke', 'full')][string]$Gate)

$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'This entry point is for hosted CI only' }
$groups = & whoami.exe /groups /fo csv /nh
if ($LASTEXITCODE -ne 0 -or ($groups -join "`n") -notmatch 'S-1-16-8192') {
    throw 'Desktop release tests require medium integrity; refusing an elevated WebView2 session'
}
Write-Host 'Desktop gate verified medium integrity (S-1-16-8192).'
Set-Location (Join-Path $PSScriptRoot '..')
if ($Gate -eq 'smoke') {
    $npmArguments = @('run', 'e2e:smoke')
} else {
    $npmArguments = @('run', 'e2e', '--', '--concurrency=1')
}
& npm.cmd @npmArguments
exit $LASTEXITCODE
