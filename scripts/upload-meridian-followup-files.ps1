$ErrorActionPreference = "Stop"

Import-Module Posh-SSH

$files = @(
  @{
    Local = (Join-Path $PSScriptRoot "..\src\lib\price-parser-meridian.mjs")
    Remote = "/srv/prices-1.1/src/lib/price-parser-meridian.mjs"
  },
  @{
    Local = (Join-Path $PSScriptRoot "..\src\lib\catalog-model.shared.js")
    Remote = "/srv/prices-1.1/src/lib/catalog-model.shared.js"
  }
)

$sec = ConvertTo-SecureString 'MEBDy0WhH1eD' -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential('root', $sec)
$ssh = New-SSHSession -ComputerName '89.169.34.218' -Credential $cred -AcceptKey -ConnectionTimeout 120

try {
  foreach ($file in $files) {
    $bytes = [System.IO.File]::ReadAllBytes($file.Local)
    $base64 = [Convert]::ToBase64String($bytes)
    $remoteDir = Split-Path -Path $file.Remote -Parent
    $remoteB64 = "$($file.Remote).b64"

    $cmd = @"
mkdir -p '$remoteDir'
cat > '$remoteB64' <<'EOF'
$base64
EOF
base64 -d '$remoteB64' > '$($file.Remote)'
rm -f '$remoteB64'
chown deploy:deploy '$($file.Remote)'
"@

    $result = Invoke-SSHCommand -SessionId $ssh.SessionId -Command $cmd -TimeOut 600000
    $result.Output

    if ($result.Error) {
      $result.Error
    }

    if ($result.ExitStatus -ne 0) {
      throw "Upload failed for $($file.Remote)"
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
  if ($ssh) {
    Remove-SSHSession -SessionId $ssh.SessionId | Out-Null
  }
}
