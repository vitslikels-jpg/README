$ErrorActionPreference = "Stop"

Import-Module Posh-SSH

$files = @(
  @{
    Local = (Join-Path $PSScriptRoot "..\src\lib\price-parser.ts")
    Remote = "/srv/prices-1.1/src/lib/price-parser.ts"
  },
  @{
    Local = (Join-Path $PSScriptRoot "..\src\lib\price-parser-meridian.mjs")
    Remote = "/srv/prices-1.1/src/lib/price-parser-meridian.mjs"
  }
)

$sec = ConvertTo-SecureString 'MEBDy0WhH1eD' -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential('root', $sec)
$ssh = New-SSHSession -ComputerName '89.169.34.218' -Credential $cred -AcceptKey -ConnectionTimeout 120
$sftp = New-SFTPSession -ComputerName '89.169.34.218' -Credential $cred -AcceptKey -ConnectionTimeout 120

try {
  foreach ($file in $files) {
    $remoteDir = Split-Path -Path $file.Remote -Parent
    $uploadCommand = "mkdir -p '$remoteDir' && chown deploy:deploy '$remoteDir'"

    $uploadResult = Invoke-SSHCommand -SessionId $ssh.SessionId -Command $uploadCommand -TimeOut 600000
    $uploadResult.Output

    if ($uploadResult.ExitStatus -ne 0) {
      throw "Upload failed for $($file.Remote): $($uploadResult.Error -join [Environment]::NewLine)"
    }

    Set-SFTPItem -SessionId $sftp.SessionId -Path $file.Local -Destination $remoteDir -Force
    $chownResult = Invoke-SSHCommand -SessionId $ssh.SessionId -Command "chown deploy:deploy '$($file.Remote)'" -TimeOut 600000

    if ($chownResult.ExitStatus -ne 0) {
      throw "chown failed for $($file.Remote): $($chownResult.Error -join [Environment]::NewLine)"
    }
  }

  $buildCommand = @'
set -e
cd /srv/prices-1.1
rm -rf .next
su -s /bin/bash deploy -c "cd /srv/prices-1.1 && npm run build"
systemctl restart prices-app.service
sleep 3
systemctl is-active prices-app.service
'@

  $buildResult = Invoke-SSHCommand -SessionId $ssh.SessionId -Command $buildCommand -TimeOut 1800000
  $buildResult.Output

  if ($buildResult.Error) {
    $buildResult.Error
  }

  if ($buildResult.ExitStatus -ne 0) {
    throw "Remote build/restart failed."
  }
} finally {
  if ($sftp) {
    Remove-SFTPSession -SessionId $sftp.SessionId | Out-Null
  }
  if ($ssh) {
    Remove-SSHSession -SessionId $ssh.SessionId | Out-Null
  }
}
