#requires -Version 7.0
param([Parameter(Mandatory)][string]$CustodyDirectory, [Parameter(Mandatory)][string]$KeyId)
$ErrorActionPreference = 'Stop'
$first = Read-Host 'New update-signing passphrase (at least 20 characters)' -AsSecureString
$second = Read-Host 'Confirm passphrase' -AsSecureString
$firstPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($first)
$secondPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($second)
try {
    $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($firstPtr)
    if ($password -cne [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secondPtr)) { throw 'Passphrases differ' }
    $info = [Diagnostics.ProcessStartInfo]::new('node')
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardInput = $true
    $info.ArgumentList.Add((Join-Path $PSScriptRoot 'update-signing.mjs'))
    $info.ArgumentList.Add('keygen')
    $info.ArgumentList.Add([IO.Path]::GetFullPath($CustodyDirectory))
    $info.ArgumentList.Add($KeyId)
    $process = [Diagnostics.Process]::Start($info)
    $process.StandardInput.WriteLine($password)
    $process.StandardInput.Close()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw 'Key generation failed. No credential was placed in process arguments.' }
} finally {
    $password = $null
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($firstPtr)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secondPtr)
    $first.Dispose(); $second.Dispose()
}
