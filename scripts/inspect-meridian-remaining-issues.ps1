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
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { normalizeCatalogText, normalizeCatalogUnit, calculateAutoMappingConfidence } = require("./src/lib/catalog-model.shared.js");
const prisma = new PrismaClient();

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

(async () => {
  const documentId = "cmnudctz00001whqeiw6ed2vh";
  const supplierId = "cmnu6y1400001wh6j3dsafcuj";

  const products = await prisma.product.findMany({
    where: { documentId },
    orderBy: { sourceRow: "asc" },
    select: {
      id: true,
      article: true,
      name: true,
      brand: true,
      country: true,
      unit: true,
      unitsPerPack: true,
      minOrderQuantity: true,
      sourceRow: true,
      rawData: true,
    },
  });

  const missingUnitsPerPack = products
    .filter((product) => {
      const rawData = asObject(product.rawData);
      return rawData?._missingUnitsPerPack === "true";
    })
    .map((product) => ({
      sourceRow: product.sourceRow,
      article: product.article,
      name: product.name,
      brand: product.brand,
      country: product.country,
      unit: product.unit,
      unitsPerPack: product.unitsPerPack,
      minOrderQuantity: product.minOrderQuantity,
      rawData: product.rawData,
    }));

  const unmappedOffers = await prisma.supplierOffer.findMany({
    where: {
      supplierId,
      priceSnapshots: {
        some: {
          documentId,
          isCurrent: true,
        },
      },
      mappings: {
        none: {
          status: "active",
        },
      },
    },
    select: {
      id: true,
      name: true,
      article: true,
      brand: true,
      normalizedName: true,
      unitsPerPack: true,
      minOrderQuantity: true,
      orderStep: true,
      legacyUnit: true,
      priceSnapshots: {
        where: {
          documentId,
          isCurrent: true,
        },
        select: {
          price: true,
          legacyProduct: {
            select: {
              sourceRow: true,
              article: true,
              name: true,
              brand: true,
              country: true,
              unitsPerPack: true,
              rawData: true,
            },
          },
        },
      },
    },
    orderBy: {
      name: "asc",
    },
  });

  const unmappedOffersWithDiagnostics = unmappedOffers.map((offer) => {
    const normalizedName = normalizeCatalogText(offer.name);
    const normalizedBrand = normalizeCatalogText(offer.brand);
    const normalizedArticle = normalizeCatalogText(offer.article);
    const unitCode = normalizeCatalogUnit(offer.legacyUnit);
    const confidence = calculateAutoMappingConfidence({
      normalizedName,
      normalizedBrand,
      normalizedArticle,
      unitCode,
      groupSize: 1,
      hasCurrentSnapshot: true,
    });

    return {
      ...offer,
      diagnostics: {
        normalizedName,
        normalizedBrand,
        normalizedArticle,
        unitCode,
        confidence,
      },
    };
  });

  console.log(
    JSON.stringify(
      {
        missingUnitsPerPack,
        unmappedOffers: unmappedOffersWithDiagnostics,
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

  if ($result.ExitStatus -ne 0) {
    throw "Remote inspect failed."
  }
} finally {
  if ($ssh) {
    Remove-SSHSession -SessionId $ssh.SessionId | Out-Null
  }
}
