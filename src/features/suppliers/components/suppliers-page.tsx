"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useEnterprise } from "@/features/enterprises/components/enterprise-context";
import { SupplierForm } from "@/features/suppliers/components/supplier-form";
import type {
  Supplier,
  SupplierDocument,
  SupplierFormValues,
  SupplierPayload,
} from "@/features/suppliers/types";

const emptySupplierForm: SupplierFormValues = {
  name: "",
  phone: "",
  managerName: "",
  email: "",
  comment: "",
  minOrderAmount: "",
};

const sourceFormatLabels: Record<SupplierDocument["sourceFormat"], string> = {
  excel: "Excel",
  pdf: "PDF",
  word: "Word",
  csv: "CSV",
  image: "Изображение",
  archive: "Архив",
  unknown: "Неизвестно",
};

const statusLabels: Record<SupplierDocument["status"], string> = {
  uploaded: "Загружен",
  processing: "Обрабатывается",
  parsed: "Разобран",
  parsed_with_errors: "Разобран с ошибками",
  failed: "Ошибка",
};

const qualityStatusLabels: Record<NonNullable<SupplierDocument["qualityReport"]>["qualityStatus"], string> = {
  good: "good",
  warning: "warning",
  bad: "bad",
};

const usabilityStatusLabels: Record<NonNullable<SupplierDocument["qualityReport"]>["usabilityStatus"], string> = {
  usable: "Готов к использованию",
  needs_review: "Требуется проверка",
  blocked: "Использование заблокировано",
};

const manualReviewStatusLabels: Record<NonNullable<SupplierDocument["qualityReport"]>["manualReviewStatus"], string> = {
  not_reviewed: "Не проверен",
  in_review: "На проверке",
  approved: "Подтвержден вручную",
  rejected: "Отклонен вручную",
};

const issueTypeLabels: Record<string, string> = {
  without_price: "Нет цены",
  without_unit: "Нет единицы измерения",
  unmapped: "Товар не сопоставлен",
  low_confidence: "Низкая уверенность распознавания",
};

const issueTypeOrder = ["without_price", "without_unit", "unmapped", "low_confidence"];
const criticalIssueTypes = new Set(["without_price", "without_unit"]);

type QualityIssue = {
  type: string;
  label: string;
  sourceRow?: number | null;
  name: string;
  article: string | null;
  price: string | null;
  unit: string | null;
  confidence: string | null;
  catalogProduct: {
    id: string;
    name: string;
  } | null;
  details?: string | null;
};

type PanelMode = "idle" | "create" | "edit";

function formatFileSize(fileSize: number) {
  if (fileSize < 1024) {
    return `${fileSize} Б`;
  }

  if (fileSize < 1024 * 1024) {
    return `${(fileSize / 1024).toFixed(1)} КБ`;
  }

  return `${(fileSize / (1024 * 1024)).toFixed(2)} МБ`;
}

function formatMoney(value: string | null) {
  if (!value) {
    return "—";
  }

  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return value;
  }

  return `${new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: numberValue % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(numberValue)} ₽`;
}

function canParseDocument(document: SupplierDocument) {
  return document.sourceFormat === "excel" || document.sourceFormat === "csv";
}

function getQualityHint(document: SupplierDocument) {
  const report = document.qualityReport;

  if (!report) {
    return "Quality-report пока не рассчитан.";
  }

  if (report.qualityStatus === "bad") {
    return report.warningMessage || "Качество плохое: прайс лучше проверить до использования.";
  }

  if (report.qualityStatus === "warning") {
    return report.warningMessage || "Есть сомнительные места в данных.";
  }

  return "Критичных проблем не найдено.";
}

function getUsabilityHint(document: SupplierDocument) {
  const report = document.qualityReport;

  if (!report) {
    return "Quality-report пока не рассчитан.";
  }

  if (report.usabilityStatus === "blocked") {
    return report.usabilityReason || "Не использовать для закупки.";
  }

  if (report.usabilityStatus === "needs_review") {
    return report.usabilityReason || "Можно использовать только после проверки.";
  }

  return report.usabilityReason || "Документ можно использовать для закупки.";
}

function formatConfidence(value: string | null) {
  if (!value) {
    return null;
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return value;
  }

  return `${Math.round(numericValue * 100)}%`;
}

function getIssueTypeLabel(type: string) {
  return issueTypeLabels[type] ?? type;
}

function buildIssueSummary(issues: QualityIssue[]) {
  return issueTypeOrder
    .map((type) => ({
      type,
      label: getIssueTypeLabel(type),
      count: issues.filter((issue) => issue.type === type).length,
    }))
    .filter((item) => item.count > 0);
}

function toFormValues(supplier: Supplier): SupplierFormValues {
  return {
    name: supplier.name,
    phone: supplier.phone ?? "",
    managerName: supplier.managerName ?? "",
    email: supplier.email ?? "",
    comment: supplier.comment ?? "",
    minOrderAmount: supplier.minOrderAmount ?? "",
  };
}

function toPayload(enterpriseId: string, values: SupplierFormValues): SupplierPayload {
  return {
    enterpriseId,
    name: values.name.trim(),
    phone: values.phone.trim(),
    managerName: values.managerName.trim(),
    email: values.email.trim(),
    comment: values.comment.trim(),
    minOrderAmount: values.minOrderAmount.trim(),
  };
}

export function SuppliersPage() {
  const { activeEnterprise, activeEnterpriseId } = useEnterprise();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [supplierDocuments, setSupplierDocuments] = useState<SupplierDocument[]>([]);
  const [search, setSearch] = useState("");
  const [panelMode, setPanelMode] = useState<PanelMode>("idle");
  const [formValues, setFormValues] = useState<SupplierFormValues>(emptySupplierForm);
  const [listError, setListError] = useState("");
  const [formError, setFormError] = useState("");
  const [documentsError, setDocumentsError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [archiveError, setArchiveError] = useState("");
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingPrice, setIsUploadingPrice] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [parsingDocumentId, setParsingDocumentId] = useState<string | null>(null);
  const [issuesByDocumentId, setIssuesByDocumentId] = useState<Record<string, QualityIssue[]>>({});
  const [criticalOnlyByDocumentId, setCriticalOnlyByDocumentId] = useState<Record<string, boolean>>({});
  const [loadingIssuesDocumentId, setLoadingIssuesDocumentId] = useState<string | null>(null);
  const [reviewCommentByDocumentId, setReviewCommentByDocumentId] = useState<Record<string, string>>({});
  const [reviewingDocumentId, setReviewingDocumentId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setSuppliers([]);
    setSelectedSupplierId(null);
    setSelectedSupplier(null);
    setSupplierDocuments([]);
    setPanelMode("idle");
    setFormValues(emptySupplierForm);
    setFormError("");
    setListError("");
    setDocumentsError("");
    setUploadError("");
    setSuccessMessage("");
    setArchiveError("");
    setParsingDocumentId(null);
    setIssuesByDocumentId({});
    setCriticalOnlyByDocumentId({});
    setLoadingIssuesDocumentId(null);
    setReviewCommentByDocumentId({});
    setReviewingDocumentId(null);

    if (!activeEnterpriseId) {
      return;
    }

    void loadSuppliers(activeEnterpriseId);
  }, [activeEnterpriseId]);

  async function loadSuppliers(enterpriseId: string) {
    setIsLoadingList(true);
    setListError("");

    try {
      const response = await fetch(`/api/suppliers?enterpriseId=${encodeURIComponent(enterpriseId)}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Не удалось получить список поставщиков.");
      }

      const data = (await response.json()) as Supplier[];
      setSuppliers(data);
    } catch (error) {
      setListError(error instanceof Error ? error.message : "Ошибка загрузки поставщиков.");
    } finally {
      setIsLoadingList(false);
    }
  }

  async function loadSupplierDocuments(supplierId: string, enterpriseId: string) {
    setIsLoadingDocuments(true);
    setDocumentsError("");

    try {
      const response = await fetch(
        `/api/suppliers/${supplierId}/documents?enterpriseId=${encodeURIComponent(enterpriseId)}`,
        { cache: "no-store" },
      );

      if (!response.ok) {
        throw new Error("Не удалось получить список прайсов.");
      }

      const documents = (await response.json()) as SupplierDocument[];
      setSupplierDocuments(documents);
      setIssuesByDocumentId({});
      setCriticalOnlyByDocumentId({});
      setReviewCommentByDocumentId(
        Object.fromEntries(documents.map((document) => [document.id, document.qualityReport?.manualReviewComment ?? ""])),
      );
    } catch (error) {
      setSupplierDocuments([]);
      setDocumentsError(error instanceof Error ? error.message : "Ошибка загрузки прайсов.");
    } finally {
      setIsLoadingDocuments(false);
    }
  }

  async function reloadSuppliers(nextSelectedId?: string) {
    if (!activeEnterpriseId) {
      return;
    }

    const response = await fetch(`/api/suppliers?enterpriseId=${encodeURIComponent(activeEnterpriseId)}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("Не удалось обновить список поставщиков.");
    }

    const data = (await response.json()) as Supplier[];
    setSuppliers(data);

    if (nextSelectedId) {
      const foundSupplier = data.find((supplier) => supplier.id === nextSelectedId) ?? null;
      setSelectedSupplier(foundSupplier);
      setSelectedSupplierId(foundSupplier?.id ?? null);
    }
  }

  async function openSupplier(supplierId: string) {
    if (!activeEnterpriseId) {
      return;
    }

    setFormError("");
    setUploadError("");
    setArchiveError("");
    setSuccessMessage("");
    setPanelMode("edit");
    setSelectedSupplierId(supplierId);
    setIsLoadingDetails(true);

    try {
      const response = await fetch(
        `/api/suppliers/${supplierId}?enterpriseId=${encodeURIComponent(activeEnterpriseId)}`,
        { cache: "no-store" },
      );

      if (!response.ok) {
        throw new Error("Не удалось получить карточку поставщика.");
      }

      const supplier = (await response.json()) as Supplier;
      setSelectedSupplier(supplier);
      setFormValues(toFormValues(supplier));
      await loadSupplierDocuments(supplierId, activeEnterpriseId);
    } catch (error) {
      setSelectedSupplier(null);
      setSupplierDocuments([]);
      setFormError(error instanceof Error ? error.message : "Ошибка загрузки поставщика.");
    } finally {
      setIsLoadingDetails(false);
    }
  }

  function openCreatePanel() {
    if (!activeEnterpriseId) {
      setFormError("Сначала выберите активное предприятие.");
      return;
    }

    setPanelMode("create");
    setSelectedSupplierId(null);
    setSelectedSupplier(null);
    setSupplierDocuments([]);
    setFormValues(emptySupplierForm);
    setFormError("");
    setDocumentsError("");
      setUploadError("");
      setSuccessMessage("");
      setArchiveError("");
      setParsingDocumentId(null);
      setIssuesByDocumentId({});
      setCriticalOnlyByDocumentId({});
  }

  function updateFormValue(field: keyof SupplierFormValues, value: string) {
    setFormValues((current) => ({ ...current, [field]: value }));
  }

  async function submitSupplier() {
    if (!activeEnterpriseId) {
      setFormError("Сначала выберите активное предприятие.");
      return;
    }

    if (!formValues.name.trim()) {
      setFormError("Укажите название поставщика.");
      return;
    }

    setFormError("");
    setArchiveError("");
    setSuccessMessage("");
    setIsSaving(true);

    try {
      const payload = toPayload(activeEnterpriseId, formValues);

      if (panelMode === "create") {
        const response = await fetch("/api/suppliers", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorBody = (await response.json().catch(() => null)) as { message?: string } | null;
          throw new Error(errorBody?.message ?? "Не удалось создать поставщика.");
        }

        const createdSupplier = (await response.json()) as Supplier;
        await reloadSuppliers(createdSupplier.id);
        setPanelMode("edit");
        setSelectedSupplier(createdSupplier);
        setSelectedSupplierId(createdSupplier.id);
        setFormValues(toFormValues(createdSupplier));
        setSupplierDocuments([]);
        setSuccessMessage(`Поставщик «${createdSupplier.name}» создан.`);
        return;
      }

      if (!selectedSupplierId) {
        throw new Error("Не выбран поставщик для редактирования.");
      }

      const response = await fetch(
        `/api/suppliers/${selectedSupplierId}?enterpriseId=${encodeURIComponent(activeEnterpriseId)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(errorBody?.message ?? "Не удалось обновить поставщика.");
      }

      const updatedSupplier = (await response.json()) as Supplier;
      await reloadSuppliers(updatedSupplier.id);
      setSelectedSupplier(updatedSupplier);
      setFormValues(toFormValues(updatedSupplier));
      setSuccessMessage("Изменения по поставщику сохранены.");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Ошибка сохранения поставщика.");
    } finally {
      setIsSaving(false);
    }
  }

  async function archiveSupplier() {
    if (!activeEnterpriseId || !selectedSupplier) {
      return;
    }

    const confirmed = window.confirm(
      `Архивировать поставщика «${selectedSupplier.name}»? Поставщик, его товары и документы будут скрыты из активной работы, но останутся в системе.`,
    );

    if (!confirmed) {
      return;
    }

    setArchiveError("");
    setSuccessMessage("");
    setIsArchiving(true);

    try {
      const response = await fetch(`/api/suppliers/${selectedSupplier.id}/archive`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ enterpriseId: activeEnterpriseId }),
      });

      const responseBody = (await response.json().catch(() => null)) as { message?: string } | null;

      if (!response.ok) {
        throw new Error(responseBody?.message ?? "Не удалось отправить поставщика в архив.");
      }

      const supplierName = selectedSupplier.name;
      await reloadSuppliers();
      setSelectedSupplierId(null);
      setSelectedSupplier(null);
      setSupplierDocuments([]);
      setPanelMode("idle");
      setFormValues(emptySupplierForm);
      setSuccessMessage(`Поставщик «${supplierName}» отправлен в архив.`);
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : "Ошибка архивирования поставщика.");
    } finally {
      setIsArchiving(false);
    }
  }

  async function uploadPrice(file: File) {
    if (!activeEnterpriseId || !selectedSupplierId) {
      setUploadError("Сначала откройте карточку поставщика.");
      return;
    }

    setUploadError("");
    setIsUploadingPrice(true);

    try {
      const formData = new FormData();
      formData.append("enterpriseId", activeEnterpriseId);
      formData.append("file", file);

      const response = await fetch(`/api/suppliers/${selectedSupplierId}/documents`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(errorBody?.message ?? "Не удалось загрузить прайс.");
      }

      await loadSupplierDocuments(selectedSupplierId, activeEnterpriseId);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Ошибка загрузки прайса.");
    } finally {
      setIsUploadingPrice(false);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function parseDocument(documentId: string) {
    if (!activeEnterpriseId || !selectedSupplierId) {
      setDocumentsError("Сначала откройте карточку поставщика.");
      return;
    }

    setDocumentsError("");
    setParsingDocumentId(documentId);

    try {
      const response = await fetch(
        `/api/documents/${documentId}/parse?enterpriseId=${encodeURIComponent(activeEnterpriseId)}`,
        {
          method: "POST",
        },
      );

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(errorBody?.message ?? "Не удалось разобрать прайс.");
      }

      await loadSupplierDocuments(selectedSupplierId, activeEnterpriseId);
    } catch (error) {
      setDocumentsError(error instanceof Error ? error.message : "Ошибка разбора прайса.");
    } finally {
      setParsingDocumentId(null);
    }
  }

  async function toggleIssues(documentId: string) {
    if (!activeEnterpriseId) {
      return;
    }

    if (issuesByDocumentId[documentId]) {
      setIssuesByDocumentId((current) => {
        const next = { ...current };
        delete next[documentId];
        return next;
      });
      return;
    }

    setDocumentsError("");
    setLoadingIssuesDocumentId(documentId);

    try {
      const response = await fetch(
        `/api/documents/${documentId}/quality-issues?enterpriseId=${encodeURIComponent(activeEnterpriseId)}`,
        { cache: "no-store" },
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? "Не удалось загрузить проблемы документа.");
      }

      const issues = (await response.json()) as QualityIssue[];
      setIssuesByDocumentId((current) => ({
        ...current,
        [documentId]: issues,
      }));
    } catch (error) {
      setDocumentsError(error instanceof Error ? error.message : "Не удалось загрузить проблемы документа.");
    } finally {
      setLoadingIssuesDocumentId(null);
    }
  }

  async function updateManualReview(
    documentId: string,
    manualReviewStatus: "in_review" | "approved" | "rejected",
  ) {
    if (!activeEnterpriseId || !selectedSupplierId) {
      return;
    }

    setDocumentsError("");
    setSuccessMessage("");
    setReviewingDocumentId(documentId);

    try {
      const response = await fetch(`/api/documents/${documentId}/quality-report`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enterpriseId: activeEnterpriseId,
          manualReviewStatus,
          manualReviewComment: reviewCommentByDocumentId[documentId] ?? "",
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? "Не удалось обновить ручную проверку.");
      }

      await loadSupplierDocuments(selectedSupplierId, activeEnterpriseId);
      setSuccessMessage("Статус ручной проверки обновлён.");
    } catch (error) {
      setDocumentsError(error instanceof Error ? error.message : "Не удалось обновить ручную проверку.");
    } finally {
      setReviewingDocumentId(null);
    }
  }

  const filteredSuppliers = suppliers.filter((supplier) =>
    supplier.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const activeEnterpriseParam = activeEnterpriseId ?? "";

  const renderDocumentIssues = (documentId: string) => {
    const allIssues = issuesByDocumentId[documentId];

    if (!allIssues?.length) {
      return null;
    }

    const criticalOnly = criticalOnlyByDocumentId[documentId] ?? false;
    const visibleIssues = criticalOnly
      ? allIssues.filter((issue) => criticalIssueTypes.has(issue.type))
      : allIssues;
    const summary = buildIssueSummary(allIssues);
    const groupedIssues = issueTypeOrder
      .map((type) => ({
        type,
        label: getIssueTypeLabel(type),
        items: visibleIssues.filter((issue) => issue.type === type),
      }))
      .filter((group) => group.items.length > 0);

    return (
      <div className="documentIssuesPanel">
        <div className="documentIssuesToolbar">
          <div className="documentIssuesSummary">
            {summary.map((item) => (
              <span key={item.type} className="documentIssuesSummaryItem">
                {item.label}: {item.count}
              </span>
            ))}
          </div>
          <div className="documentIssuesFilter">
            <button
              className={`compactToggleButton ${!criticalOnly ? "compactToggleButtonActive" : ""}`}
              type="button"
              onClick={() =>
                setCriticalOnlyByDocumentId((current) => ({
                  ...current,
                  [documentId]: false,
                }))
              }
            >
              Все проблемы
            </button>
            <button
              className={`compactToggleButton ${criticalOnly ? "compactToggleButtonActive" : ""}`}
              type="button"
              onClick={() =>
                setCriticalOnlyByDocumentId((current) => ({
                  ...current,
                  [documentId]: true,
                }))
              }
            >
              Только критичные
            </button>
          </div>
        </div>

        {groupedIssues.length ? (
          <div className="documentIssuesList">
            {groupedIssues.map((group) => (
              <section key={group.type} className="documentIssueGroup">
                <div className="documentIssueGroupHeader">
                  <strong>{group.label}</strong>
                  <span>{group.items.length}</span>
                </div>

                {group.items.map((issue, index) => (
                  <div
                    key={`${group.type}-${issue.sourceRow ?? "na"}-${index}`}
                    className={`documentIssueRow documentIssueRow-${group.type}`}
                  >
                    <div className="documentIssueRowTop">
                      <strong>{issue.name}</strong>
                      <span className="documentIssueTypeRaw">{issue.type}</span>
                    </div>
                    <div className="documentIssueMeta">
                      <span>{issue.sourceRow ? `Строка ${issue.sourceRow}` : "Строка: —"}</span>
                      <span>{issue.article ? `Артикул: ${issue.article}` : "Артикул: —"}</span>
                      <span>Цена: {formatMoney(issue.price)}</span>
                      <span>Единица: {issue.unit || "—"}</span>
                      {issue.confidence ? <span>Уверенность: {formatConfidence(issue.confidence)}</span> : null}
                      <span>Catalog: {issue.catalogProduct ? issue.catalogProduct.name : "нет связки"}</span>
                    </div>
                    {issue.details ? <p className="documentIssueHint">{issue.details}</p> : null}
                  </div>
                ))}
              </section>
            ))}
          </div>
        ) : (
          <p className="documentQualityHint">Критичных проблем в первых 50 проблемах не найдено.</p>
        )}
      </div>
    );
  };

  return (
    <div className="pageStack">
      <section className="heroCard">
        <p className="panelEyebrow">Поставщики</p>
        <h2 className="pageTitle">Справочник поставщиков</h2>
        <p className="pageDescription">
          Здесь хранится список поставщиков для выбранного предприятия. В карточке поставщика можно редактировать
          данные, загружать прайсы, запускать их разбор и отправлять поставщика в архив без удаления данных.
        </p>
      </section>

      {!activeEnterpriseId ? (
        <section className="card pagePlaceholder">
          <p className="panelEyebrow">Поставщики</p>
          <h2 className="pageTitle">Сначала выберите предприятие</h2>
          <p className="pageDescription">
            Чтобы посмотреть или создать поставщиков, выберите активное предприятие в верхней панели.
          </p>
        </section>
      ) : (
        <div className="suppliersLayout">
          <section className="card suppliersCard">
            <div className="cardHeader">
              <div>
                <p className="panelEyebrow">Активное предприятие</p>
                <h2 className="sectionTitle">{activeEnterprise?.name ?? "Предприятие"}</h2>
              </div>

              <button className="primaryButton compactButton" type="button" onClick={openCreatePanel}>
                Добавить поставщика
              </button>
            </div>

            <div className="suppliersToolbar">
              <label className="field">
                <span>Поиск по названию</span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Начните вводить название"
                />
              </label>
            </div>

            {listError ? <p className="errorText">{listError}</p> : null}
            {successMessage ? <p className="successText">{successMessage}</p> : null}

            <div className="supplierList">
              {isLoadingList ? (
                <div className="emptyState">
                  <p className="emptyStateTitle">Загрузка поставщиков</p>
                  <p className="emptyStateText">Список поставщиков загружается.</p>
                </div>
              ) : filteredSuppliers.length === 0 && suppliers.length === 0 ? (
                <div className="emptyState">
                  <p className="emptyStateTitle">Поставщиков пока нет</p>
                  <p className="emptyStateText">Добавьте первого поставщика для выбранного предприятия.</p>
                </div>
              ) : filteredSuppliers.length === 0 ? (
                <div className="emptyState">
                  <p className="emptyStateTitle">Ничего не найдено</p>
                  <p className="emptyStateText">По текущему запросу поставщики не найдены.</p>
                </div>
              ) : (
                filteredSuppliers.map((supplier) => {
                  const isActive = supplier.id === selectedSupplierId;

                  return (
                    <button
                      key={supplier.id}
                      type="button"
                      className={`supplierRow ${isActive ? "supplierRowActive" : ""}`}
                      onClick={() => void openSupplier(supplier.id)}
                    >
                      <div className="supplierRowMain">
                        <h3>{supplier.name}</h3>
                        <p>{supplier.phone || "Телефон не указан"}</p>
                      </div>

                      <div className="supplierRowMeta">
                        <span>{supplier.managerName || "Менеджер не указан"}</span>
                        <span>{supplier.email || "Email не указан"}</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          <aside className="card supplierPanel">
            {panelMode === "idle" ? (
              <div className="supplierPanelContent">
                <p className="panelEyebrow">Карточка</p>
                <h2 className="sectionTitle">Выберите поставщика</h2>
                <p className="pageDescription">
                  Откройте поставщика из списка или создайте нового. Здесь будет форма просмотра, редактирования и блок
                  прайсов.
                </p>
                {archiveError ? <p className="errorText">{archiveError}</p> : null}
              </div>
            ) : isLoadingDetails ? (
              <div className="supplierPanelContent">
                <p className="panelEyebrow">Карточка</p>
                <h2 className="sectionTitle">Загрузка</h2>
                <p className="pageDescription">Данные поставщика загружаются.</p>
              </div>
            ) : (
              <SupplierForm
                values={formValues}
                disabled={isSaving}
                errorMessage={formError}
                submitLabel={panelMode === "create" ? "Создать поставщика" : "Сохранить изменения"}
                title={panelMode === "create" ? "Новый поставщик" : formValues.name || "Карточка поставщика"}
                description={
                  panelMode === "create"
                    ? "Заполните основные данные поставщика."
                    : "Изменения сохраняются только для активного предприятия."
                }
                onChange={updateFormValue}
                onSubmit={() => void submitSupplier()}
              >
                {panelMode === "edit" && selectedSupplier ? (
                  <>
                    <div className="supplierDangerZone">
                      <div>
                        <p className="panelEyebrow">Архив</p>
                        <p className="panelText">
                          Поставщик исчезнет из активной работы, но не удалится. Восстановить его можно из раздела
                          «Архив».
                        </p>
                      </div>

                      <button
                        type="button"
                        className="secondaryButton compactButton archiveButton"
                        disabled={isArchiving}
                        onClick={() => void archiveSupplier()}
                      >
                        {isArchiving ? "Переносим..." : "В архив"}
                      </button>
                    </div>

                    {archiveError ? <p className="errorText">{archiveError}</p> : null}

                    <div className="supplierMeta supplierMetaWide">
                      <div className="supplierMetaItem">
                        <span>Создан</span>
                        <strong>{new Date(selectedSupplier.createdAt).toLocaleString("ru-RU")}</strong>
                      </div>
                      <div className="supplierMetaItem">
                        <span>Обновлён</span>
                        <strong>{new Date(selectedSupplier.updatedAt).toLocaleString("ru-RU")}</strong>
                      </div>
                      <div className="supplierMetaItem">
                        <span>Мин. сумма заказа</span>
                        <strong>{formatMoney(selectedSupplier.minOrderAmount)}</strong>
                      </div>
                    </div>

                    <section className="documentsSection">
                      <div className="documentsHeader">
                        <div>
                          <p className="panelEyebrow">Прайсы</p>
                          <h3 className="documentsTitle">Загруженные прайсы</h3>
                          <p className="panelText">
                            Разобранные товары потом видны в разделе{" "}
                            <Link
                              href={`/products?enterpriseId=${encodeURIComponent(activeEnterpriseParam)}&supplierId=${encodeURIComponent(selectedSupplier.id)}`}
                              className="textLink"
                            >
                              «Товары»
                            </Link>
                            .
                          </p>
                        </div>

                        <div className="documentsActions">
                          <Link
                            href={`/products?enterpriseId=${encodeURIComponent(activeEnterpriseParam)}&supplierId=${encodeURIComponent(selectedSupplier.id)}`}
                            className="secondaryButton compactButton"
                          >
                            Открыть товары
                          </Link>
                          <input
                            ref={fileInputRef}
                            className="hiddenInput"
                            type="file"
                            onChange={(event) => {
                              const nextFile = event.target.files?.[0];

                              if (nextFile) {
                                void uploadPrice(nextFile);
                              }
                            }}
                          />
                          <button
                            className="primaryButton compactButton"
                            type="button"
                            disabled={isUploadingPrice}
                            onClick={() => fileInputRef.current?.click()}
                          >
                            {isUploadingPrice ? "Загрузка..." : "Загрузить прайс"}
                          </button>
                        </div>
                      </div>

                      {uploadError ? <p className="errorText">{uploadError}</p> : null}
                      {documentsError ? <p className="errorText">{documentsError}</p> : null}

                      <div className="documentsList">
                        {isLoadingDocuments ? (
                          <div className="emptyState">
                            <p className="emptyStateTitle">Загрузка прайсов</p>
                            <p className="emptyStateText">Список прайсов загружается.</p>
                          </div>
                        ) : supplierDocuments.length === 0 ? (
                          <div className="emptyState">
                            <p className="emptyStateTitle">Прайсов пока нет</p>
                            <p className="emptyStateText">Нажмите «Загрузить прайс», чтобы добавить первый файл.</p>
                          </div>
                        ) : (
                          supplierDocuments.map((document) => (
                            <article key={document.id} className="documentCard">
                              <div className="documentCardHeader">
                                <strong className="documentName">{document.originalFileName}</strong>
                                <span className="statusPill">{document.isCurrent ? "Текущий" : "Не текущий"}</span>
                              </div>

                              <dl className="documentGrid">
                                <div className="documentField">
                                  <dt>Формат</dt>
                                  <dd>{sourceFormatLabels[document.sourceFormat]}</dd>
                                </div>
                                <div className="documentField">
                                  <dt>Размер</dt>
                                  <dd>{formatFileSize(document.fileSize)}</dd>
                                </div>
                                <div className="documentField">
                                  <dt>Загружен</dt>
                                  <dd>{new Date(document.uploadedAt).toLocaleString("ru-RU")}</dd>
                                </div>
                                <div className="documentField">
                                  <dt>Статус</dt>
                                  <dd>{statusLabels[document.status]}</dd>
                                </div>
                              </dl>

                              <div className="documentQualityCard">
                                <div className="documentQualityHeader">
                                  <strong>Качество данных</strong>
                                  <span className={`statusPill qualityStatusPill qualityStatus-${document.qualityReport?.qualityStatus ?? "warning"}`}>
                                    {document.qualityReport ? qualityStatusLabels[document.qualityReport.qualityStatus] : "n/a"}
                                  </span>
                                </div>
                                <div className="documentQualityMeta">
                                  <span>Всего строк: {document.qualityReport?.totalRows ?? "—"}</span>
                                  <span>Разобрано: {document.qualityReport?.parsedProductsCount ?? "—"}</span>
                                  <span>Без цены: {document.qualityReport?.rowsWithoutPrice ?? "—"}</span>
                                  <span>Без unit: {document.qualityReport?.rowsWithoutUnit ?? "—"}</span>
                                  <span>Unmapped offers: {document.qualityReport?.unmappedOffersCount ?? "—"}</span>
                                  <span>Low confidence: {document.qualityReport?.lowConfidenceMappingsCount ?? "—"}</span>
                                </div>
                                <p
                                  className={`documentQualityHint ${
                                    document.qualityReport?.qualityStatus === "bad" ? "documentQualityHintBad" : ""
                                  }`}
                                >
                                  {getQualityHint(document)}
                                </p>

                                <div className="documentQualityHeader">
                                  <strong>Использование</strong>
                                  <span className={`statusPill usabilityStatusPill usabilityStatus-${document.qualityReport?.usabilityStatus ?? "needs_review"}`}>
                                    {document.qualityReport ? usabilityStatusLabels[document.qualityReport.usabilityStatus] : "n/a"}
                                  </span>
                                </div>
                                <p
                                  className={`documentQualityHint ${
                                    document.qualityReport?.usabilityStatus === "blocked" ? "documentQualityHintBad" : ""
                                  }`}
                                >
                                  {getUsabilityHint(document)}
                                </p>

                                <div className="documentQualityHeader">
                                  <strong>Ручная проверка</strong>
                                  <span className="statusPill">
                                    {document.qualityReport ? manualReviewStatusLabels[document.qualityReport.manualReviewStatus] : "n/a"}
                                  </span>
                                </div>
                                <label className="field">
                                  <span>Комментарий проверки</span>
                                  <textarea
                                    value={reviewCommentByDocumentId[document.id] ?? ""}
                                    onChange={(event) =>
                                      setReviewCommentByDocumentId((current) => ({
                                        ...current,
                                        [document.id]: event.target.value,
                                      }))
                                    }
                                    rows={3}
                                  />
                                </label>
                                <div className="documentReviewActions">
                                  <button
                                    className="secondaryButton compactButton"
                                    type="button"
                                    disabled={reviewingDocumentId === document.id}
                                    onClick={() => void updateManualReview(document.id, "in_review")}
                                  >
                                    {reviewingDocumentId === document.id ? "..." : "Начать проверку"}
                                  </button>
                                  <button
                                    className="primaryButton compactButton"
                                    type="button"
                                    disabled={reviewingDocumentId === document.id}
                                    onClick={() => void updateManualReview(document.id, "approved")}
                                  >
                                    {reviewingDocumentId === document.id ? "..." : "Подтвердить вручную"}
                                  </button>
                                  <button
                                    className="dangerButton compactButton"
                                    type="button"
                                    disabled={reviewingDocumentId === document.id}
                                    onClick={() => void updateManualReview(document.id, "rejected")}
                                  >
                                    {reviewingDocumentId === document.id ? "..." : "Отклонить"}
                                  </button>
                                </div>
                                {document.qualityReport?.manualReviewComment ? (
                                  <p className="documentQualityHint">
                                    Последний комментарий: {document.qualityReport.manualReviewComment}
                                  </p>
                                ) : null}

                                <button
                                  className="secondaryButton compactButton"
                                  type="button"
                                  disabled={loadingIssuesDocumentId === document.id}
                                  onClick={() => void toggleIssues(document.id)}
                                >
                                  {loadingIssuesDocumentId === document.id
                                    ? "Загрузка..."
                                    : issuesByDocumentId[document.id]
                                      ? "Скрыть проблемы"
                                      : "Показать проблемы"}
                                </button>

                                {false ? (
                                  <div className="documentIssuesList">
                                    {issuesByDocumentId[document.id].map((issue, index) => (
                                      <div key={`${issue.type}-${issue.sourceRow ?? "na"}-${index}`} className="documentIssueRow">
                                        <strong>{issue.name}</strong>
                                        <span>
                                          {issue.sourceRow ? `Строка ${issue.sourceRow} • ` : ""}
                                          {issue.name}
                                          {issue.article ? ` • ${issue.article}` : ""}
                                        </span>
                                        <span>Проблема: {issue.label}</span>
                                        <span>{issue.article ? `Артикул: ${issue.article}` : "Артикул: —"}</span>
                                        <span>Цена: {formatMoney(issue.price)}</span>
                                        <span>Единица: {issue.unit || "—"}</span>
                                        {issue.confidence ? <span>Confidence: {issue.confidence}</span> : null}
                                        <span>Связка с catalog: {issue.catalogProduct ? issue.catalogProduct.name : "нет"}</span>
                                        {issue.details ? <span>{issue.details}</span> : null}
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                                {renderDocumentIssues(document.id)}
                              </div>

                              <div className="documentActions">
                                <button
                                  className="secondaryButton compactButton"
                                  type="button"
                                  disabled={
                                    parsingDocumentId === document.id ||
                                    document.status === "processing" ||
                                    !canParseDocument(document)
                                  }
                                  onClick={() => void parseDocument(document.id)}
                                >
                                  {parsingDocumentId === document.id ? "Разбор..." : "Разобрать прайс"}
                                </button>

                                {!canParseDocument(document) ? (
                                  <span className="documentHint">Сейчас разбор работает только для Excel и CSV.</span>
                                ) : null}
                              </div>
                            </article>
                          ))
                        )}
                      </div>
                    </section>
                  </>
                ) : null}
              </SupplierForm>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
