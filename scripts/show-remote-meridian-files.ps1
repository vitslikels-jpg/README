$ErrorActionPreference = "Stop"

Import-Module Posh-SSH

$sec = ConvertTo-SecureString 'MEBDy0WhH1eD' -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential('root', $sec)
$ssh = New-SSHSession -ComputerName '89.169.34.218' -Credential $cred -AcceptKey -ConnectionTimeout 120

try {
  $cmd = @'
cd /srv/prices-1.1
python3 <<'"'"'PY'"'"'
from pathlib import Path

targets = [
    ("src/lib/price-parser-meridian.mjs", 1, 260),
    ("src/lib/catalog-model.shared.js", 1, 220),
]

for rel, start, end in targets:
    print("FILE", rel)
    text = Path(rel).read_text(encoding="utf-8")
    for idx, line in enumerate(text.splitlines(), start=1):
        if start <= idx <= end:
            print(f"{idx}: {line}")
    print("END_FILE")
PY
'@

  $result = Invoke-SSHCommand -SessionId $ssh.SessionId -Command $cmd -TimeOut 600000
  $result.Output

  if ($result.Error) {
    $result.Error
  }
} finally {
  if ($ssh) {
    Remove-SSHSession -SessionId $ssh.SessionId | Out-Null
  }
}
