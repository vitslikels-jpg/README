import * as XLSX from "xlsx";
import { jsonUtf8 } from "@/lib/http";
import { buildPriceChangesReport } from "@/lib/reports/price-changes";

function formatDateTime(value: string | null) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  }).format(date);
}

function formatDate(value: string | null) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Moscow",
  }).format(date);
}

function formatMoney(value: string | null) {
  if (!value) {
    return "—";
  }

  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return value;
  }

  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatSignedValue(value: string | null) {
  if (!value) {
    return "—";
  }

  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return value;
  }

  return `${amount > 0 ? "+" : ""}${new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)}`;
}

function formatSignedPercent(value: string | null) {
  if (!value) {
    return "—";
  }

  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return value;
  }

  return `${amount > 0 ? "+" : ""}${new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: Math.abs(amount) % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount)}%`;
}

function getStatusLabel(status: "confirmed" | "requires_review") {
  return status === "confirmed" ? "Подтверждено" : "Требует проверки";
}

function getSourceLabel(source: "invoice") {
  return source === "invoice" ? "Накладная" : source;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const enterpriseId = searchParams.get("enterpriseId")?.trim();
  const periodRaw = searchParams.get("period")?.trim() ?? "7d";
  const dateFrom = searchParams.get("dateFrom")?.trim() ?? null;
  const dateTo = searchParams.get("dateTo")?.trim() ?? null;
  const supplierId = searchParams.get("supplierId")?.trim() ?? "";
  const query = searchParams.get("q")?.trim() ?? "";
  const directionRaw = searchParams.get("direction")?.trim() ?? "all";

  if (!enterpriseId) {
    return jsonUtf8({ message: "Параметр enterpriseId обязателен." }, { status: 400 });
  }

  const result = await buildPriceChangesReport({
    enterpriseId,
    periodRaw,
    dateFrom,
    dateTo,
    supplierId,
    query,
    directionRaw,
  });

  if (!result.ok) {
    return jsonUtf8({ message: result.message }, { status: result.status });
  }

  const headers = [
    "Дата изменения",
    "Поставщик",
    "Товар",
    "Старая цена",
    "Новая цена",
    "Изменение ₽",
    "Изменение %",
    "Накладная",
    "Дата накладной",
    "Статус",
    "Источник",
  ];
  const rows = result.data.items.map((item) => [
    formatDateTime(item.changedAt),
    item.supplierName,
    item.productName,
    formatMoney(item.oldPrice),
    formatMoney(item.newPrice),
    formatSignedValue(item.differenceAmount),
    formatSignedPercent(item.differencePercent),
    item.invoiceNumber?.trim() || "—",
    formatDate(item.invoiceDate),
    getStatusLabel(item.status),
    getSourceLabel(item.source),
  ]);

  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  worksheet["!cols"] = [
    { wch: 18 },
    { wch: 28 },
    { wch: 48 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 18 },
    { wch: 18 },
    { wch: 20 },
    { wch: 16 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Изменение цен");

  const buffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  });

  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="price-changes-report.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
