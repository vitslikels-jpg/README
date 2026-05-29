import { prisma } from "@/lib/prisma";

type SupplierMatchType = "phone" | "email" | "exact_name" | "contains_name";

type SupplierMatchResult = {
  supplierId: string;
  supplierName: string;
  confidence: number;
  matchType: SupplierMatchType;
};

type SupplierCandidate = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
};

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/["'`«»“”„]/g, " ")
    .replace(/[^\p{L}\p{N}\s@.+-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePhone(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

function normalizeEmail(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildWordBoundaryPattern(value: string) {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(value)}([^\\p{L}\\p{N}]|$)`, "iu");
}

function extractEmails(rawText: string) {
  return Array.from(new Set(rawText.toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? []));
}

function extractPhones(rawText: string) {
  const matches = rawText.match(/(?:\+?\d[\d\s().-]{7,}\d)/g) ?? [];
  return Array.from(
    new Set(
      matches
        .map((value) => normalizePhone(value))
        .filter((value) => value.length >= 10),
    ),
  );
}

function getNameMatchType(rawTextNormalized: string, supplier: SupplierCandidate): SupplierMatchResult | null {
  const normalizedName = normalizeText(supplier.name);

  if (!normalizedName || normalizedName.length < 3) {
    return null;
  }

  if (rawTextNormalized.includes(normalizedName) || buildWordBoundaryPattern(normalizedName).test(rawTextNormalized)) {
    return {
      supplierId: supplier.id,
      supplierName: supplier.name,
      confidence: 0.85,
      matchType: "exact_name",
    };
  }

  const nameWords = normalizedName.split(" ").filter((word) => word.length >= 3);

  if (nameWords.length === 0) {
    return null;
  }

  const matchedWords = nameWords.filter((word) => buildWordBoundaryPattern(word).test(rawTextNormalized));

  if (matchedWords.length >= Math.min(2, nameWords.length)) {
    return {
      supplierId: supplier.id,
      supplierName: supplier.name,
      confidence: 0.7,
      matchType: "contains_name",
    };
  }

  return null;
}

export function matchInvoiceSupplierFromCandidates(rawText: string, suppliers: SupplierCandidate[]): SupplierMatchResult | null {
  const normalizedRawText = normalizeText(rawText);

  if (suppliers.length === 0) {
    return null;
  }

  if (!normalizedRawText) {
    return null;
  }

  const emailsInText = extractEmails(rawText);

  for (const supplier of suppliers) {
    const supplierEmail = normalizeEmail(supplier.email);

    if (supplierEmail && emailsInText.includes(supplierEmail)) {
      return {
        supplierId: supplier.id,
        supplierName: supplier.name,
        confidence: 0.9,
        matchType: "email",
      };
    }
  }

  const phonesInText = extractPhones(rawText);

  for (const supplier of suppliers) {
    const supplierPhone = normalizePhone(supplier.phone);

    if (!supplierPhone) {
      continue;
    }

    const matchedPhone = phonesInText.find((phone) => phone.endsWith(supplierPhone) || supplierPhone.endsWith(phone));

    if (matchedPhone) {
      return {
        supplierId: supplier.id,
        supplierName: supplier.name,
        confidence: 0.9,
        matchType: "phone",
      };
    }
  }

  const nameMatches = suppliers
    .map((supplier) => getNameMatchType(normalizedRawText, supplier))
    .filter((match): match is SupplierMatchResult => match !== null)
    .sort((left, right) => right.confidence - left.confidence || left.supplierName.localeCompare(right.supplierName, "ru"));

  return nameMatches[0] ?? null;
}

export async function matchInvoiceSupplier(rawText: string, enterpriseId: string): Promise<SupplierMatchResult | null> {
  const suppliers = await prisma.supplier.findMany({
    where: {
      enterpriseId,
      archivedAt: null,
    },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
    },
    orderBy: {
      name: "asc",
    },
  });

  return matchInvoiceSupplierFromCandidates(rawText, suppliers);
}
