$ErrorActionPreference = "Stop"

Import-Module Posh-SSH

$sec = ConvertTo-SecureString 'MEBDy0WhH1eD' -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential('root', $sec)
$ssh = New-SSHSession -ComputerName '89.169.34.218' -Credential $cred -AcceptKey -ConnectionTimeout 120

try {
  $cmd = @'
set -e
cd /srv/prices-1.1
su -s /bin/bash deploy -c 'cd /srv/prices-1.1 && node <<'"'"'NODE'"'"'
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const MERIDIAN_SUPPLIER_ID = "cmnu6y1400001wh6j3dsafcuj";
const MERIDIAN_DOCUMENT_ID = "cmnudctz00001whqeiw6ed2vh";

function escapeRegExp(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

(async () => {
  const supplier = await prisma.supplier.findFirst({
    where: { id: MERIDIAN_SUPPLIER_ID },
    select: {
      id: true,
      name: true,
      documents: {
        orderBy: { uploadedAt: "desc" },
        take: 5,
        select: {
          id: true,
          originalFileName: true,
          status: true,
          uploadedAt: true,
          isCurrent: true,
          qualityReport: true,
        },
      },
    },
  });

  if (!supplier) {
    console.log(JSON.stringify({ error: "Meridian supplier not found" }, null, 2));
    return;
  }

  const document =
    supplier.documents.find((item) => item.id === MERIDIAN_DOCUMENT_ID) ??
    supplier.documents.find((item) => item.isCurrent) ??
    supplier.documents[0];

  if (!document) {
    console.log(JSON.stringify({ error: "Meridian document not found", supplier }, null, 2));
    return;
  }
  const products = await prisma.product.findMany({
    where: { documentId: document.id },
    orderBy: { sourceRow: "asc" },
    select: {
      article: true,
      name: true,
      brand: true,
      country: true,
      unit: true,
      unitsPerPack: true,
      minOrderQuantity: true,
        price: true,
        sourceRow: true,
        rawData: true,
    },
  });

  const normalize = (value) => String(value ?? "").trim();
  const getRaw = (rawData, key) =>
    rawData && typeof rawData === "object" && !Array.isArray(rawData) ? normalize(rawData[key]) : "";

  const rowsMissingUnitsPerPack = [];
  const rowsDirtyName = [];
  const rowsBrandCaseMismatch = [];
  const rowsCountryCaseMismatch = [];

  for (const product of products) {
    const rawBrand = getRaw(product.rawData, "Бренд");
    const rawCountry = getRaw(product.rawData, "Страна");
    const rawUnitsPerPack = getRaw(product.rawData, "Шт в коробке");

    if (!product.unitsPerPack && rawUnitsPerPack) {
      rowsMissingUnitsPerPack.push({
        sourceRow: product.sourceRow,
        article: product.article,
        name: product.name,
        brand: product.brand,
        country: product.country,
        unitsPerPack: product.unitsPerPack,
        rawUnitsPerPack,
      });
    }

    const dirtyParts = [];
    if (rawBrand && new RegExp(`(^|\\s)${escapeRegExp(rawBrand)}(?=\\s|$)`, "iu").test(product.name)) {
      dirtyParts.push(`brand:${rawBrand}`);
    }
    if (rawCountry && new RegExp(`(^|\\s)${escapeRegExp(rawCountry)}(?=\\s|$)`, "iu").test(product.name)) {
      dirtyParts.push(`country:${rawCountry}`);
    }
    if (/\*\s*\d+(?:[.,]\d+)?\s*шт\b/iu.test(product.name)) {
      dirtyParts.push("boxPattern");
    }

    if (dirtyParts.length) {
      rowsDirtyName.push({
        sourceRow: product.sourceRow,
        article: product.article,
        name: product.name,
        brand: product.brand,
        country: product.country,
        dirtyParts,
      });
    }

    if (rawBrand && product.brand && rawBrand !== product.brand) {
      rowsBrandCaseMismatch.push({
        sourceRow: product.sourceRow,
        article: product.article,
        name: product.name,
        rawBrand,
        parsedBrand: product.brand,
      });
    }

    if (rawCountry && product.country && rawCountry !== product.country) {
      rowsCountryCaseMismatch.push({
        sourceRow: product.sourceRow,
        article: product.article,
        name: product.name,
        rawCountry,
        parsedCountry: product.country,
      });
    }
  }

  const countrySet = [...new Set(products.map((product) => product.country).filter(Boolean))].sort((a, b) =>
    String(a).localeCompare(String(b), "ru"),
  );
  const probeArticles = ["903736", "906945", "906153", "900113", "900101"];
  const probeRows = products
    .filter((product) => probeArticles.includes(String(product.article ?? "")))
    .map((product) => ({
      sourceRow: product.sourceRow,
      article: product.article,
      name: product.name,
      brand: product.brand,
      country: product.country,
      unit: product.unit,
      unitsPerPack: product.unitsPerPack,
      minOrderQuantity: product.minOrderQuantity,
      price: product.price,
      rawUnitsPerPack: getRaw(product.rawData, "Шт в коробке"),
      rawBrand: getRaw(product.rawData, "Бренд"),
      rawCountry: getRaw(product.rawData, "Страна"),
      rawName: getRaw(product.rawData, "НоменклатураПредставление"),
    }));

  console.log(
    JSON.stringify(
      {
        supplier: supplier.name,
        document,
        totals: {
          products: products.length,
          rowsMissingUnitsPerPack: rowsMissingUnitsPerPack.length,
          rowsDirtyName: rowsDirtyName.length,
          rowsBrandCaseMismatch: rowsBrandCaseMismatch.length,
        rowsCountryCaseMismatch: rowsCountryCaseMismatch.length,
      },
      countrySet,
      probeRows,
      examples: {
          rowsMissingUnitsPerPack: rowsMissingUnitsPerPack.slice(0, 12),
          rowsDirtyName: rowsDirtyName.slice(0, 12),
          rowsBrandCaseMismatch: rowsBrandCaseMismatch.slice(0, 12),
          rowsCountryCaseMismatch: rowsCountryCaseMismatch.slice(0, 12),
        },
      },
      null,
      2,
    ),
  );
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
