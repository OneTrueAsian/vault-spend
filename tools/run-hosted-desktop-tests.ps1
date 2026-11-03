param(
    [Parameter(Mandatory)][ValidateSet('smoke', 'full')][string]$Gate,
    # 'N/TOTAL': run only this slice of the full gate, so the hosted job's shards can run at the same time (full gate only).
    [ValidatePattern('^[1-9]\d*/[1-9]\d*$')][string]$Shard
)

$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'This entry point is for hosted CI only' }
if ($Shard -and $Gate -ne 'full') { throw 'A shard applies to the full gate only; the smoke preflight always runs whole' }
$groups = & whoami.exe /groups /fo csv /nh
if ($LASTEXITCODE -ne 0 -or ($groups -join "`n") -notmatch 'S-1-16-8192') {
    throw 'Desktop release tests require medium integrity; refusing an elevated WebView2 session'
}
Write-Host 'Desktop gate verified medium integrity (S-1-16-8192).'
Set-Location (Join-Path $PSScriptRoot '..')
if ($Gate -eq 'smoke') {
    $npmArguments = @('run', 'e2e:smoke')
} else {
    # A spec that fails is run once more, alone, after the rest; a retried pass is reported as flaky with its first failure in full.
    $npmArguments = @('run', 'e2e', '--', '--concurrency=1', '--retry-failed')
    if ($Shard) { $npmArguments += "--shard=$Shard" }
}
& npm.cmd @npmArguments
exit $LASTEXITCODE
