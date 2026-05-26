$ErrorActionPreference = "Stop"

Import-Module Posh-SSH

$documentId = "cmnudctz00001whqeiw6ed2vh"
$enterpriseId = "cmnu4otxd0000wh5txht0mnsm"

$sec = ConvertTo-SecureString 'MEBDy0WhH1eD' -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential('root', $sec)
$ssh = New-SSHSession -ComputerName '89.169.34.218' -Credential $cred -AcceptKey -ConnectionTimeout 120

try {
  $cmd = @'
set -e
cd /srv/prices-1.1
su -s /bin/bash deploy -c 'cd /srv/prices-1.1 && node <<'"'"'NODE'"'"'
require("dotenv").config();
const crypto = require("crypto");
const http = require("http");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

function toBase64Url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function createSessionToken() {
  const login = String(process.env.APP_LOGIN || "").trim();
  const secret = String(process.env.APP_SESSION_SECRET || process.env.APP_PASSWORD_HASH || "").trim();
  const expiresAt = String(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const signature = crypto.createHmac("sha256", secret).update(login + "." + expiresAt).digest();
  return expiresAt + "." + toBase64Url(signature);
}

function request(method, path, body, cookie) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: 3000,
        path,
        method,
        headers: {
          ...(data
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(data),
              }
            : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
      },
      (res) => {
        let chunks = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          chunks += chunk;
        });
        res.on("end", () => {
          try {
            resolve({
              status: res.statusCode,
              body: chunks ? JSON.parse(chunks) : null,
            });
          } catch {
            resolve({
              status: res.statusCode,
              body: chunks,
            });
          }
        });
      },
    );
    req.on("error", reject);
    if (data) {
      req.write(data);
    }
    req.end();
  });
}

(async () => {
  const sessionToken = createSessionToken();
  const cookie = `citadel_session=${sessionToken}`;
  const result = await request(
    "POST",
    "/api/documents/cmnudctz00001whqeiw6ed2vh/parse?enterpriseId=cmnu4otxd0000wh5txht0mnsm",
    {},
    cookie,
  );
  console.log("PARSE_RESULT_START");
  console.log(JSON.stringify(result, null, 2));
  console.log("PARSE_RESULT_END");

  const document = await prisma.document.findUnique({
    where: { id: "cmnudctz00001whqeiw6ed2vh" },
    include: {
      qualityReport: true,
    },
  });

  const products = await prisma.product.findMany({
    where: {
      documentId: "cmnudctz00001whqeiw6ed2vh",
      article: {
        in: ["903736", "906153", "900113", "900101", "906945"],
      },
    },
    orderBy: {
      sourceRow: "asc",
    },
    select: {
      article: true,
      name: true,
      brand: true,
      country: true,
      unit: true,
      unitsPerPack: true,
      minOrderQuantity: true,
      shipByBoxesOnly: true,
      price: true,
      sourceRow: true,
      rawData: true,
    },
  });

  console.log("MERIDIAN_DOC_START");
  console.log(JSON.stringify({
    document: {
      id: document?.id,
      status: document?.status,
      isCurrent: document?.isCurrent,
      qualityReport: document?.qualityReport,
    },
    products,
  }, null, 2));
  console.log("MERIDIAN_DOC_END");
})()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
NODE'
'@

  $result = Invoke-SSHCommand -SessionId $ssh.SessionId -Command $cmd -TimeOut 1800000
  $result.Output

  if ($result.Error) {
    $result.Error
  }

  if ($result.ExitStatus -ne 0) {
    throw "Remote reparse failed."
  }
} finally {
  if ($ssh) {
    Remove-SSHSession -SessionId $ssh.SessionId | Out-Null
  }
}
