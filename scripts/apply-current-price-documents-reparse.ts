import 'dotenv/config';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PrismaClient, type DocumentStatus } from '@prisma/client';
import { parsePriceDocument } from '@/lib/price-parser';
import { extractWeightPackFromNameOrRawData, sanitizeUnitsPerPackCandidate } from '@/lib/price-parser-packaging.mjs';

type DocRow = {
  id: string;
  enterpriseId: string;
  supplierId: string;
  originalFileName: string;
  status: DocumentStatus;
  isCurrent: boolean;
  supplier: { name: string };
};

type ProductSnapshot = {
  sourceRow: number;
  article: string | null;
  name: string;
  unit: string | null;
  unitsPerPack: number | null;
  price: number | null;
  rawData?: Record<string, unknown> | null;
};

type DryRunDocResult = {
  documentId: string;
  supplierName: string;
  originalFileName: string;
  statusBefore: DocumentStatus;
  statusAfter: DocumentStatus;
  productsBefore: number;
  productsAfter: number;
  priceChanges: number;
  unitChanges: number;
  unitsPerPackChanges: number;
  deletedProductsCount: number;
  newProductsCount: number;
  suspiciousUnitsPerPackCount: number;
  durationMs: number;
  safe: boolean;
};

type ApplyDocResult = DryRunDocResult & {
  parseStatus: string | null;
  skippedCount: number | null;
  parsedCount: number | null;
  errors: string[];
};

type AuditCounts = {
  weight_name_non_weight_unit: number;
  pack_in_name_unitsPerPack_missing_or_1: number;
  beef_lt_500: number;
  chicken_lt_250: number;
  bacon_lt_300: number;
};

const prisma = new PrismaClient();
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_PRODUCT_DIFF_ABS = 0;
const MAX_PRODUCT_DIFF_PERCENT = 0.02;
const SUSPICIOUS_PACKS = new Set([61, 64, 68, 69]);
const sanitizeUnitsPerPackCandidateTyped =
  sanitizeUnitsPerPackCandidate as (input: {
    unitsPerPack?: number | null;
    name?: string;
    packaging?: string;
    rawData?: Record<string, unknown>;
    extractedWeightPack?: ReturnType<typeof extractWeightPackFromNameOrRawData> | null;
    shipByBoxesOnly?: boolean;
  }) => number | null;

function nowIso() {
  return new Date().toISOString();
}

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalize(value: unknown) {
  return String(value ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/gu, ' ').trim();
}

function productKey(product: ProductSnapshot) {
  return `${product.sourceRow}::${product.article ?? ''}::${product.name}`;
}

function ensureParentDir(filePath: string) {
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
}

function writeLog(logFile: string, event: string, payload: Record<string, unknown>) {
  ensureParentDir(logFile);
  appendFileSync(logFile, JSON.stringify({ ts: nowIso(), event, ...payload }) + '\n', 'utf8');
}

function parseArgs(argv: string[]) {
  const args = new Map<string, string | true>();
  for (const part of argv) {
    if (!part.startsWith('--')) continue;
    const eq = part.indexOf('=');
    if (eq === -1) {
      args.set(part.slice(2), true);
    } else {
      args.set(part.slice(2, eq), part.slice(eq + 1));
    }
  }
  return {
    dryRun: args.has('dry-run'),
    apply: args.has('apply'),
    allCurrent: args.has('all-current'),
    documentId: typeof args.get('documentId') === 'string' ? String(args.get('documentId')) : null,
    logFile: typeof args.get('logFile') === 'string' ? String(args.get('logFile')) : `/tmp/reparse-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.log`,
    internalApplyOne: args.has('internal-apply-one'),
  };
}

async function getDocuments({ allCurrent, documentId }: { allCurrent: boolean; documentId: string | null; }) {
  if (!allCurrent && !documentId) {
    throw new Error('Нужно передать --documentId=... или --all-current');
  }

  const where = documentId
    ? { id: documentId }
    : { isCurrent: true, type: 'price_list' as const };

  const docs = await prisma.document.findMany({
    where,
    select: {
      id: true,
      enterpriseId: true,
      supplierId: true,
      originalFileName: true,
      status: true,
      isCurrent: true,
      supplier: { select: { name: true } },
    },
    orderBy: [{ supplier: { name: 'asc' } }, { updatedAt: 'asc' }],
  });

  if (docs.length === 0) {
    throw new Error('Документы не найдены');
  }

  return docs as DocRow[];
}

async function getProducts(documentId: string): Promise<ProductSnapshot[]> {
  const rows = await prisma.product.findMany({
    where: { documentId },
    select: {
      sourceRow: true,
      article: true,
      name: true,
      unit: true,
      unitsPerPack: true,
      price: true,
      rawData: true,
    },
    orderBy: { sourceRow: 'asc' },
  });

  return rows.map((row) => ({
    sourceRow: row.sourceRow,
    article: row.article,
    name: row.name,
    unit: row.unit,
    unitsPerPack: toNumber(row.unitsPerPack),
    price: toNumber(row.price),
    rawData: row.rawData as Record<string, unknown> | null,
  }));
}

function packText(rawData: Record<string, unknown> | null | undefined) {
  if (!rawData || typeof rawData !== 'object') return '';
  return String(
    rawData.packaging ?? rawData['Фасовка'] ?? rawData['фасовка'] ?? rawData.detectedPackaging ?? rawData['Вес'] ?? rawData['вес'] ?? '',
  );
}

function predictProduct(product: ProductSnapshot): ProductSnapshot {
  const extracted = extractWeightPackFromNameOrRawData({
    name: product.name,
    packaging: packText(product.rawData),
    rawData: product.rawData ?? undefined,
  });

  const unitsPerPack = sanitizeUnitsPerPackCandidateTyped({
    unitsPerPack: extracted?.isWeighted && extracted.unitsPerPack ? extracted.unitsPerPack : product.unitsPerPack,
    name: product.name,
    packaging: packText(product.rawData),
    rawData: product.rawData ?? undefined,
    extractedWeightPack: extracted,
    shipByBoxesOnly: String(product.rawData?.shipByBoxesOnly ?? '').toLowerCase() === 'true',
  });

  return {
    ...product,
    unit: extracted?.isWeighted ? extracted.unit : product.unit,
    unitsPerPack,
  };
}

function compareProducts(before: ProductSnapshot[], after: ProductSnapshot[]) {
  const beforeMap = new Map(before.map((item) => [productKey(item), item]));
  const afterMap = new Map(after.map((item) => [productKey(item), item]));

  let priceChanges = 0;
  let unitChanges = 0;
  let unitsPerPackChanges = 0;
  let deletedProductsCount = 0;
  let newProductsCount = 0;

  for (const [key, beforeItem] of beforeMap) {
    const afterItem = afterMap.get(key);
    if (!afterItem) {
      deletedProductsCount += 1;
      continue;
    }
    if ((beforeItem.price ?? null) !== (afterItem.price ?? null)) priceChanges += 1;
    if ((beforeItem.unit ?? null) !== (afterItem.unit ?? null)) unitChanges += 1;
    if ((beforeItem.unitsPerPack ?? null) !== (afterItem.unitsPerPack ?? null)) unitsPerPackChanges += 1;
  }

  for (const key of afterMap.keys()) {
    if (!beforeMap.has(key)) newProductsCount += 1;
  }

  return { priceChanges, unitChanges, unitsPerPackChanges, deletedProductsCount, newProductsCount };
}

function suspiciousUnitsPerPackCount(products: ProductSnapshot[]) {
  return products.filter((item) => item.unitsPerPack != null && SUSPICIOUS_PACKS.has(Number(item.unitsPerPack))).length;
}

function isProductCountDifferenceUnsafe(beforeCount: number, afterCount: number) {
  const absDiff = Math.abs(afterCount - beforeCount);
  const percentDiff = beforeCount === 0 ? (afterCount === 0 ? 0 : 1) : absDiff / beforeCount;
  return absDiff > MAX_PRODUCT_DIFF_ABS || percentDiff > MAX_PRODUCT_DIFF_PERCENT;
}

function isDryRunSafe(result: Omit<DryRunDocResult, 'safe'>) {
  if (result.priceChanges > 0) return false;
  if (result.suspiciousUnitsPerPackCount > 0) return false;
  if (isProductCountDifferenceUnsafe(result.productsBefore, result.productsAfter)) return false;
  return true;
}

async function runDryRunForDoc(doc: DocRow): Promise<DryRunDocResult> {
  const startedAt = Date.now();
  const before = await getProducts(doc.id);
  const predicted = before.map(predictProduct);
  const compared = compareProducts(before, predicted);
  const resultBase = {
    documentId: doc.id,
    supplierName: doc.supplier.name,
    originalFileName: doc.originalFileName,
    statusBefore: doc.status,
    statusAfter: doc.status,
    productsBefore: before.length,
    productsAfter: predicted.length,
    ...compared,
    suspiciousUnitsPerPackCount: suspiciousUnitsPerPackCount(predicted),
    durationMs: Date.now() - startedAt,
  };

  return {
    ...resultBase,
    safe: isDryRunSafe(resultBase),
  };
}

function emptyAuditCounts(): AuditCounts {
  return {
    weight_name_non_weight_unit: 0,
    pack_in_name_unitsPerPack_missing_or_1: 0,
    beef_lt_500: 0,
    chicken_lt_250: 0,
    bacon_lt_300: 0,
  };
}

function auditFlags(product: ProductSnapshot) {
  const counts: string[] = [];
  const extracted = extractWeightPackFromNameOrRawData({
    name: product.name,
    packaging: packText(product.rawData),
    rawData: product.rawData ?? undefined,
  });
  const name = normalize(product.name);
  const unit = normalize(product.unit);
  const price = product.price;
  const unitsPerPack = product.unitsPerPack;

  if (extracted?.isWeighted && !['кг', 'г', 'л', 'мл'].includes(unit)) counts.push('weight_name_non_weight_unit');
  if (extracted?.isWeighted && extracted.unitsPerPack && extracted.unitsPerPack > 1 && (unitsPerPack == null || unitsPerPack === 1)) {
    counts.push('pack_in_name_unitsPerPack_missing_or_1');
  }
  if (name.includes('говядин') && price != null && price < 500) counts.push('beef_lt_500');
  if ((name.includes('кур') || name.includes('цыпл')) && price != null && price < 250) counts.push('chicken_lt_250');
  if (name.includes('бекон') && price != null && price < 300) counts.push('bacon_lt_300');
  return counts;
}

async function buildAudit(docs: DocRow[]) {
  const products = await prisma.product.findMany({
    where: { documentId: { in: docs.map((doc) => doc.id) } },
    select: { sourceRow: true, article: true, name: true, unit: true, unitsPerPack: true, price: true, rawData: true },
  });
  const counts = emptyAuditCounts();
  for (const row of products) {
    const snapshot: ProductSnapshot = {
      sourceRow: row.sourceRow,
      article: row.article,
      name: row.name,
      unit: row.unit,
      unitsPerPack: toNumber(row.unitsPerPack),
      price: toNumber(row.price),
      rawData: row.rawData as Record<string, unknown> | null,
    };
    for (const flag of auditFlags(snapshot)) {
      counts[flag as keyof AuditCounts] += 1;
    }
  }
  return counts;
}

function serializeError(error: unknown) {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

async function runApplyDirectForDoc(docId: string) {
  const result = await parsePriceDocument(docId);
  return result;
}

async function runApplyChild(doc: DocRow, logFile: string): Promise<ApplyDocResult> {
  const startedAt = Date.now();
  const beforeDoc = await prisma.document.findUniqueOrThrow({
    where: { id: doc.id },
    select: { status: true },
  });
  const beforeProducts = await getProducts(doc.id);

  const scriptPath = path.resolve(process.cwd(), 'scripts', 'apply-current-price-documents-reparse.ts');
  const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const childArgs = ['tsx', scriptPath, '--apply', `--documentId=${doc.id}`, `--logFile=${logFile}`, '--internal-apply-one'];

  const childResult = await new Promise<{ stdout: string; stderr: string; code: number | null; timedOut: boolean }>((resolve) => {
    const child = spawn(npxBin, childArgs, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      resolve({ stdout, stderr, code: null, timedOut: true });
    }, DEFAULT_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut: false });
    });
  });

  const afterDoc = await prisma.document.findUniqueOrThrow({
    where: { id: doc.id },
    select: { status: true },
  });
  const afterProducts = await getProducts(doc.id);
  const compared = compareProducts(beforeProducts, afterProducts);
  const suspiciousCount = suspiciousUnitsPerPackCount(afterProducts);

  let parsedPayload: { status?: string; skippedCount?: number; parsedCount?: number; message?: string } | null = null;
  if (childResult.stdout.trim()) {
    try {
      parsedPayload = JSON.parse(childResult.stdout.trim());
    } catch {
      parsedPayload = null;
    }
  }

  const errors: string[] = [];
  if (childResult.timedOut) errors.push(`timeout>${DEFAULT_TIMEOUT_MS}ms`);
  if (childResult.code && childResult.code !== 0) errors.push(`exitCode=${childResult.code}`);
  if (childResult.stderr.trim()) errors.push(childResult.stderr.trim());
  if (parsedPayload?.message) errors.push(parsedPayload.message);

  return {
    documentId: doc.id,
    supplierName: doc.supplier.name,
    originalFileName: doc.originalFileName,
    statusBefore: beforeDoc.status,
    statusAfter: afterDoc.status,
    productsBefore: beforeProducts.length,
    productsAfter: afterProducts.length,
    ...compared,
    suspiciousUnitsPerPackCount: suspiciousCount,
    durationMs: Date.now() - startedAt,
    safe: errors.length === 0 && suspiciousCount === 0 && compared.priceChanges === 0 && !isProductCountDifferenceUnsafe(beforeProducts.length, afterProducts.length),
    parseStatus: parsedPayload?.status ?? null,
    skippedCount: parsedPayload?.skippedCount ?? null,
    parsedCount: parsedPayload?.parsedCount ?? null,
    errors,
  };
}

async function runInternalApplyOne(documentId: string, logFile: string) {
  const startedAt = Date.now();
  writeLog(logFile, 'internal_apply_start', { documentId });
  try {
    const result = await runApplyDirectForDoc(documentId);
    writeLog(logFile, 'internal_apply_done', { documentId, durationMs: Date.now() - startedAt, result });
    process.stdout.write(JSON.stringify(result));
  } catch (error) {
    writeLog(logFile, 'internal_apply_error', { documentId, durationMs: Date.now() - startedAt, error: serializeError(error) });
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.dryRun === args.apply) {
    throw new Error('Нужно выбрать ровно один режим: --dry-run или --apply');
  }

  if (args.internalApplyOne) {
    if (!args.documentId) throw new Error('Для --internal-apply-one нужен --documentId');
    await runInternalApplyOne(args.documentId, args.logFile);
    return;
  }

  const docs = await getDocuments({ allCurrent: args.allCurrent, documentId: args.documentId });
  writeLog(args.logFile, 'start', {
    mode: args.dryRun ? 'dry-run' : 'apply',
    documents: docs.map((doc) => ({ id: doc.id, supplierName: doc.supplier.name, originalFileName: doc.originalFileName, status: doc.status })),
  });

  const beforeAudit = await buildAudit(docs);
  const dryRunResults = [] as DryRunDocResult[];
  for (const doc of docs) {
    const result = await runDryRunForDoc(doc);
    dryRunResults.push(result);
    writeLog(args.logFile, 'dry_run_document', result);
  }

  const safe = dryRunResults.every((item) => item.safe);
  const summary = {
    safe,
    totalDocuments: dryRunResults.length,
    totalPriceChanges: dryRunResults.reduce((sum, item) => sum + item.priceChanges, 0),
    totalSuspiciousUnitsPerPack: dryRunResults.reduce((sum, item) => sum + item.suspiciousUnitsPerPackCount, 0),
  };
  writeLog(args.logFile, 'dry_run_summary', summary);

  if (args.dryRun) {
    console.log(JSON.stringify({ mode: 'dry-run', logFile: args.logFile, safe, dryRunResults, beforeAudit }, null, 2));
    return;
  }

  if (!safe) {
    writeLog(args.logFile, 'apply_blocked', summary);
    console.log(JSON.stringify({ mode: 'apply', logFile: args.logFile, safe: false, dryRunResults, beforeAudit, applyResults: [], afterAudit: beforeAudit }, null, 2));
    process.exitCode = 2;
    return;
  }

  const applyResults = [] as ApplyDocResult[];
  for (const doc of docs) {
    const result = await runApplyChild(doc, args.logFile);
    applyResults.push(result);
    writeLog(args.logFile, 'apply_document', result);
    if (result.errors.length > 0) {
      writeLog(args.logFile, 'apply_stopped', { documentId: doc.id, supplierName: doc.supplier.name, errors: result.errors });
      break;
    }
  }

  const afterAudit = await buildAudit(docs);
  writeLog(args.logFile, 'apply_summary', { totalDocuments: applyResults.length, afterAudit });
  console.log(JSON.stringify({ mode: 'apply', logFile: args.logFile, safe: true, dryRunResults, applyResults, beforeAudit, afterAudit }, null, 2));
}

main()
  .catch((error) => {
    const args = parseArgs(process.argv.slice(2));
    writeLog(args.logFile, 'fatal', { error: serializeError(error) });
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
