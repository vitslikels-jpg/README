"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, PencilLine, Search, Sparkles, WalletCards } from "lucide-react";
import { useEnterprise } from "@/features/enterprises/components/enterprise-context";
import type {
  OrderOptimizationItem,
  OrderOptimizationListItem,
  OrderOptimizationResult,
  OrderOptimizationSupplierBasket,
  SmartOrderAiParseTestItem,
  SmartOrderAiParseTestResponse,
} from "@/features/order-optimizations/types";

type PickerState = {
  itemId: string;
  query: string;
};

type SmartOrderLine = {
  item: OrderOptimizationItem;
  productName: string;
  quantityText: string;
  totalText: string;
  totalNumber: number | null;
};

type SmartOrderGroup = {
  supplierName: string;
  items: SmartOrderLine[];
  totalText: string | null;
  totalNumber: number | null;
};

type SmartOrderProblemItem = {
  item: OrderOptimizationItem;
  candidate: OrderOptimizationResult | null;
  reasons: string[];
};

const SEARCH_DEBOUNCE_MS = 250;

function isApiErrorResponse(value: unknown): value is { message?: string } {
  return Boolean(value && typeof value === "object" && "message" in value);
}

function formatMoney(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return String(value);
  }

  return `${new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: numberValue % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(numberValue)} ₽`;
}

function formatAmount(quantity: string | null | undefined, unit: string | null | undefined) {
  if (!quantity && !unit) {
    return "Не распознано";
  }

  return [quantity, unit].filter(Boolean).join(" ");
}

function getSelectedCandidate(item: OrderOptimizationItem) {
  return item.results.find((result) => result.id === item.selectedCandidateId) ?? null;
}

function getLineTotalNumber(item: OrderOptimizationItem) {
  const candidate = getSelectedCandidate(item);

  if (!candidate?.optimizedLineTotal) {
    return null;
  }

  const numberValue = Number(candidate.optimizedLineTotal);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function buildSmartOrderGroups(items: OrderOptimizationItem[]) {
  const groups = new Map<string, SmartOrderLine[]>();

  for (const item of items) {
    const candidate = getSelectedCandidate(item);
    const supplierName =
      candidate?.selectedSupplier?.name?.trim() ||
      item.requestedSupplierName?.trim() ||
      "Нужно подобрать";
    const packsCount = candidate?.coverage?.suggestedPacksCount;
    const quantityText = packsCount ? `${packsCount} уп` : formatAmount(item.parsedQuantity, item.parsedUnit);
    const line: SmartOrderLine = {
      item,
      productName: candidate?.selectedProduct?.name?.trim() || item.parsedName?.trim() || item.sourceLine,
      quantityText,
      totalText: formatMoney(candidate?.optimizedLineTotal) ?? "—",
      totalNumber: getLineTotalNumber(item),
    };
    const currentItems = groups.get(supplierName) ?? [];

    currentItems.push(line);
    groups.set(supplierName, currentItems);
  }

  return Array.from(groups.entries()).map<SmartOrderGroup>(([supplierName, supplierItems]) => {
    const totalNumber = supplierItems.reduce<number | null>((sum, line) => {
      if (line.totalNumber === null) {
        return sum;
      }

      return (sum ?? 0) + line.totalNumber;
    }, null);

    return {
      supplierName,
      items: supplierItems,
      totalText: formatMoney(totalNumber),
      totalNumber,
    };
  });
}

function buildCopyText(groups: SmartOrderGroup[]) {
  return groups
    .map((group) => {
      const lines = group.items.map((line) => `${line.productName} — ${line.quantityText} — ${line.totalText}`);
      return `${group.supplierName}\n${lines.join("\n")}`;
    })
    .join("\n\n");
}

function getBasketStatusText(basket: OrderOptimizationSupplierBasket) {
  if (!basket.minOrderAmount) {
    return "Минималка не задана";
  }

  if (basket.meetsMinOrder) {
    return "Минималка выполнена";
  }

  return `Не хватает ${formatMoney(basket.missingAmount) ?? basket.missingAmount}`;
}

function buildBasketCopyText(basket: OrderOptimizationSupplierBasket) {
  const lines = basket.items.map((item, index) => {
    const quantityText = [item.quantity, item.unit].filter(Boolean).join(" ").trim();
    return `${index + 1}. ${item.selectedProductName || item.parsedName || "Товар"}${
      quantityText ? ` — ${quantityText}` : ""
    }`;
  });

  return [`Поставщик: ${basket.supplierName}`, ...lines].join("\n");
}

function buildProblemItems(items: OrderOptimizationItem[]) {
  return items.reduce<SmartOrderProblemItem[]>((acc, item) => {
    const candidate = getSelectedCandidate(item);
    const reasons: string[] = [];

    if (item.matchStatus === "not_found" || item.status === "not_found" || !candidate?.selectedProductId) {
      reasons.push("Не найден товар");
    }

    if (!item.selectedCandidateId) {
      reasons.push("Нет selectedCandidateId");
    }

    if (item.selectedCandidateId && !candidate?.selectedSupplierId) {
      reasons.push("Нет поставщика");
    }

    if (item.selectedCandidateId && (!candidate?.optimizedUnitPrice || !candidate.optimizedLineTotal)) {
      reasons.push("Нет цены");
    }

    if (item.status === "review" || item.matchStatus === "review") {
      reasons.push("Нужно ручное подтверждение");
    }

    if (reasons.length > 0) {
      acc.push({ item, candidate, reasons });
    }

    return acc;
  }, []);
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fallback below
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  let copied = false;

  try {
    copied = document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }

  return copied;
}

async function createOptimization(enterpriseId: string, sourceText: string) {
  const response = await fetch("/api/order-optimizations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      enterpriseId,
      sourceText,
    }),
  });
  const responseBody = (await response.json().catch(() => null)) as
    | OrderOptimizationListItem
    | { message?: string }
    | null;

  if (!response.ok || !responseBody || isApiErrorResponse(responseBody)) {
    throw new Error(
      isApiErrorResponse(responseBody) && responseBody.message
        ? responseBody.message
        : "Не удалось создать умный заказ.",
    );
  }

  return responseBody;
}

async function parseOptimization(enterpriseId: string, optimization: OrderOptimizationListItem) {
  const response = await fetch(`/api/order-optimizations/${optimization.id}/parse`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      enterpriseId,
      title: optimization.title,
      sourceText: optimization.sourceText,
    }),
  });
  const responseBody = (await response.json().catch(() => null)) as
    | OrderOptimizationListItem
    | { message?: string }
    | null;

  if (!response.ok || !responseBody || isApiErrorResponse(responseBody)) {
    throw new Error(
      isApiErrorResponse(responseBody) && responseBody.message
        ? responseBody.message
        : "Не удалось разобрать заказ.",
    );
  }

  return responseBody;
}

async function matchOptimization(enterpriseId: string, optimizationId: string) {
  const response = await fetch(`/api/order-optimizations/${optimizationId}/match`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      enterpriseId,
    }),
  });
  const responseBody = (await response.json().catch(() => null)) as
    | OrderOptimizationListItem
    | { message?: string }
    | null;

  if (!response.ok || !responseBody || isApiErrorResponse(responseBody)) {
    throw new Error(
      isApiErrorResponse(responseBody) && responseBody.message
        ? responseBody.message
        : "Не удалось подобрать варианты.",
    );
  }

  return responseBody;
}

async function runAiParseTest(sourceText: string) {
  const response = await fetch("/api/order-optimizations/ai-parse-test", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sourceText,
    }),
  });
  const responseBody = (await response.json().catch(() => null)) as
    | SmartOrderAiParseTestResponse
    | { message?: string }
    | null;

  if (!response.ok || !responseBody || isApiErrorResponse(responseBody) || !("items" in responseBody)) {
    throw new Error(
      isApiErrorResponse(responseBody) && responseBody.message
        ? responseBody.message
        : "Не удалось проверить AI-разбор.",
    );
  }

  return responseBody;
}

export function OrderOptimizationPage() {
  const { activeEnterpriseId } = useEnterprise();
  const [sourceText, setSourceText] = useState("");
  const [selectedOptimization, setSelectedOptimization] = useState<OrderOptimizationListItem | null>(null);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [searchResults, setSearchResults] = useState<OrderOptimizationResult[] | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isMatching, setIsMatching] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [copyingBasketSupplierName, setCopyingBasketSupplierName] = useState<string | null>(null);
  const [selectingCandidateId, setSelectingCandidateId] = useState<string | null>(null);
  const [aiParseTestSourceText, setAiParseTestSourceText] = useState(
    "бекон 3 кг\nАлиди: рис 5 кг, сахар 10 кг\nВосток-Запад: сыр Galbani 500 г аналог можно",
  );
  const [aiParseTestResult, setAiParseTestResult] = useState<SmartOrderAiParseTestResponse | null>(null);
  const [aiParseTestError, setAiParseTestError] = useState("");
  const [isAiParseTesting, setIsAiParseTesting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    setSelectedOptimization(null);
    setPicker(null);
    setSearchResults(null);
    setDebouncedQuery("");
    setErrorMessage("");
    setSuccessMessage("");
    setAiParseTestResult(null);
    setAiParseTestError("");
  }, [activeEnterpriseId]);

  useEffect(() => {
    if (!picker) {
      setDebouncedQuery("");
      setSearchResults(null);
      setIsSearchLoading(false);
      return;
    }

    setIsSearchLoading(true);
    const timer = window.setTimeout(() => {
      setDebouncedQuery(picker.query.trim().toLowerCase());
      setIsSearchLoading(false);
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [picker]);

  const smartOrderGroups = useMemo(
    () => buildSmartOrderGroups(selectedOptimization?.items ?? []),
    [selectedOptimization?.items],
  );

  const smartOrderText = useMemo(() => buildCopyText(smartOrderGroups), [smartOrderGroups]);

  const overallTotal = useMemo(() => {
    const total = smartOrderGroups.reduce<number | null>((sum, group) => {
      if (group.totalNumber === null) {
        return sum;
      }

      return (sum ?? 0) + group.totalNumber;
    }, null);

    return formatMoney(total);
  }, [smartOrderGroups]);

  const problemItems = useMemo(
    () => buildProblemItems(selectedOptimization?.items ?? []),
    [selectedOptimization?.items],
  );

  const pickerItem = useMemo(() => {
    if (!picker || !selectedOptimization) {
      return null;
    }

    return selectedOptimization.items.find((item) => item.id === picker.itemId) ?? null;
  }, [picker, selectedOptimization]);

  const filteredCandidates = useMemo(() => {
    if (!pickerItem) {
      return [];
    }

    if (!debouncedQuery) {
      return pickerItem.results;
    }

    return searchResults ?? [];
  }, [debouncedQuery, pickerItem, searchResults]);

  useEffect(() => {
    if (!activeEnterpriseId || !selectedOptimization || !pickerItem || !debouncedQuery) {
      setSearchResults(null);
      return;
    }

    let cancelled = false;
    setIsSearchLoading(true);

    void (async () => {
      try {
        const response = await fetch(
          `/api/order-optimizations/${selectedOptimization.id}/items/${pickerItem.id}/search`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              enterpriseId: activeEnterpriseId,
              query: debouncedQuery,
            }),
          },
        );
        const responseBody = (await response.json().catch(() => null)) as
          | { results?: OrderOptimizationResult[]; message?: string }
          | null;

        if (!response.ok || !responseBody?.results) {
          throw new Error(responseBody?.message || "Не удалось найти товары.");
        }

        if (!cancelled) {
          setSearchResults(responseBody.results);
        }
      } catch (error) {
        if (!cancelled) {
          setSearchResults([]);
          setErrorMessage(error instanceof Error ? error.message : "Не удалось найти товары.");
        }
      } finally {
        if (!cancelled) {
          setIsSearchLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeEnterpriseId, debouncedQuery, pickerItem, selectedOptimization]);

  async function handleRunSmartOrder() {
    if (!activeEnterpriseId || !sourceText.trim()) {
      return;
    }

    setIsRunning(true);
    setErrorMessage("");
    setSuccessMessage("");
    setPicker(null);

    try {
      const created = await createOptimization(activeEnterpriseId, sourceText);
      const parsed = await parseOptimization(activeEnterpriseId, created);
      const matched = await matchOptimization(activeEnterpriseId, parsed.id);

      setSelectedOptimization(matched);
      setSuccessMessage("Готово. Умный заказ собран.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось собрать умный заказ.");
    } finally {
      setIsRunning(false);
    }
  }

  async function handleMatchVariants() {
    if (!activeEnterpriseId) {
      return;
    }

    if (!selectedOptimization) {
      await handleRunSmartOrder();
      return;
    }

    setIsMatching(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const matched = await matchOptimization(activeEnterpriseId, selectedOptimization.id);
      setSelectedOptimization(matched);
      setSuccessMessage("Варианты обновлены.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось подобрать варианты.");
    } finally {
      setIsMatching(false);
    }
  }

  async function handleCopyOrder() {
    if (!smartOrderText) {
      return;
    }

    setIsCopying(true);
    setErrorMessage("");

    try {
      const copied = await copyTextToClipboard(smartOrderText);

      if (!copied) {
        throw new Error("copy failed");
      }

      setSuccessMessage("Заказ скопирован.");
    } catch {
      setErrorMessage("Не удалось скопировать заказ.");
    } finally {
      setIsCopying(false);
    }
  }

  async function handleCopyBasket(basket: OrderOptimizationSupplierBasket) {
    const text = buildBasketCopyText(basket);

    if (!text) {
      return;
    }

    setCopyingBasketSupplierName(basket.supplierName);
    setErrorMessage("");

    try {
      const copied = await copyTextToClipboard(text);

      if (!copied) {
        throw new Error("copy failed");
      }

      setSuccessMessage(`Заказ поставщику "${basket.supplierName}" скопирован.`);
    } catch {
      setErrorMessage(`Не удалось скопировать заказ поставщику "${basket.supplierName}".`);
    } finally {
      setCopyingBasketSupplierName(null);
    }
  }

  async function handleSelectCandidate(item: OrderOptimizationItem, candidate: OrderOptimizationResult) {
    if (!activeEnterpriseId || !selectedOptimization || selectingCandidateId) {
      return;
    }

    setSelectingCandidateId(candidate.id);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const response = await fetch(
        `/api/order-optimizations/${selectedOptimization.id}/items/${item.id}/select-candidate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            enterpriseId: activeEnterpriseId,
            candidateId: candidate.id,
          }),
        },
      );
      const responseBody = (await response.json().catch(() => null)) as
        | OrderOptimizationListItem
        | { message?: string }
        | null;

      if (!response.ok || !responseBody || isApiErrorResponse(responseBody)) {
        throw new Error(
          isApiErrorResponse(responseBody) && responseBody.message
            ? responseBody.message
            : "Не удалось заменить товар.",
        );
      }

      setSelectedOptimization(responseBody);
      setPicker(null);
      setSearchResults(null);
      setSuccessMessage("Товар заменён, итог обновлён.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось заменить товар.");
    } finally {
      setSelectingCandidateId(null);
    }
  }

  function openPicker(item: OrderOptimizationItem) {
    const selectedCandidate = getSelectedCandidate(item);
    setSearchResults(null);
    setPicker({
      itemId: item.id,
      query: selectedCandidate?.selectedProduct?.name?.trim() || item.parsedName?.trim() || "",
    });
  }

  async function handleAiParseTest() {
    if (!aiParseTestSourceText.trim()) {
      return;
    }

    setIsAiParseTesting(true);
    setAiParseTestError("");

    try {
      const result = await runAiParseTest(aiParseTestSourceText);
      setAiParseTestResult(result);
    } catch (error) {
      setAiParseTestResult(null);
      setAiParseTestError(error instanceof Error ? error.message : "Не удалось проверить AI-разбор.");
    } finally {
      setIsAiParseTesting(false);
    }
  }

  const aiParseTestSection = (
    <section className="card smartOrderAiParseTestCard">
      <div className="smartOrderCardHeader smartOrderCardHeaderSimple">
        <div>
          <h2 className="sectionTitle">AI parse test</h2>
          <p className="pageDescription smartOrderAiParseTestNote">Тестовый режим, не влияет на заказ.</p>
        </div>
      </div>

      {aiParseTestError ? <p className="errorText">{aiParseTestError}</p> : null}

      <div className="smartOrderTextareaWrap">
        <textarea
          className="fieldTextarea smartOrderTextarea smartOrderAiParseTextarea"
          value={aiParseTestSourceText}
          onChange={(event) => setAiParseTestSourceText(event.target.value)}
          placeholder={"бекон 3 кг\nАлиди: рис 5 кг, сахар 10 кг\nВосток-Запад: сыр Galbani 500 г аналог можно"}
        />
      </div>

      <div className="smartOrderActions smartOrderActionsPrimary">
        <button
          type="button"
          className="secondaryButton"
          disabled={isAiParseTesting || !aiParseTestSourceText.trim()}
          onClick={() => void handleAiParseTest()}
        >
          <Sparkles size={16} />
          <span>{isAiParseTesting ? "Проверяем..." : "Проверить AI-разбор"}</span>
        </button>
      </div>

      {aiParseTestResult ? (
        <div className="smartOrderAiParseResults">
          <div className="smartOrderAiParseSummary">
            <span className="statusPill">source: {aiParseTestResult.source}</span>
            <span className="statusPill">model: {aiParseTestResult.model}</span>
            <span className="statusPill">items: {aiParseTestResult.items.length}</span>
          </div>

          <div className="smartOrderProblemList">
            {aiParseTestResult.items.map((item: SmartOrderAiParseTestItem, index) => (
              <section key={`${item.originalLine}-${index}`} className="smartOrderProblemCard smartOrderAiParseCard">
                <div className="smartOrderProblemHeader">
                  <div className="smartOrderProblemMain">
                    <h3>{item.parsedName || "Не удалось выделить название"}</h3>
                    <p>{item.originalLine}</p>
                  </div>
                  <span className={`statusPill ${item.needsReview ? "smartOrderProblemReason" : ""}`}>
                    {item.needsReview ? "Нужна проверка" : "Ок"}
                  </span>
                </div>

                <div className="smartOrderAiParseGrid">
                  <span><strong>Количество:</strong> {formatAmount(item.quantity, item.unit)}</span>
                  <span><strong>Поставщик:</strong> {item.requestedSupplierName || "—"}</span>
                  <span><strong>Бренд:</strong> {item.brand || "—"}</span>
                  <span><strong>Confidence:</strong> {item.confidence}</span>
                  <span><strong>Attributes:</strong> {item.attributes.length ? item.attributes.join(", ") : "—"}</span>
                  <span><strong>Comment:</strong> {item.comment || "—"}</span>
                  <span><strong>Review reason:</strong> {item.reviewReason || "—"}</span>
                </div>
              </section>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );

  if (!activeEnterpriseId) {
    return (
      <div className="pageStack">
        <section className="card pagePlaceholder">
          <h2 className="pageTitle">Сначала выберите предприятие</h2>
          <p className="pageDescription">Без выбранного предприятия умный заказ работать не будет.</p>
        </section>
        {aiParseTestSection}
      </div>
    );
  }

  return (
    <>
      <div className="pageStack smartOrderPage">
        <section className="smartOrderHero">
          <h1 className="pageTitle">Умный заказ</h1>
          <p className="pageDescription">
            Вставьте список товаров и получите готовый заказ по поставщикам. AI попытается сам исправить опечатки,
            кривые названия и неполные строки заказа.
          </p>
        </section>

        <section className="card smartOrderComposerCard smartOrderComposerCardPrimary">
          <div className="smartOrderCardHeader smartOrderCardHeaderSimple">
            <div>
              <h2 className="sectionTitle">Исходный текст заказа</h2>
            </div>
          </div>

          {errorMessage ? <p className="errorText">{errorMessage}</p> : null}
          {successMessage ? <p className="successText">{successMessage}</p> : null}

          <div className="smartOrderTextareaWrap">
            <textarea
              className="fieldTextarea smartOrderTextarea"
              value={sourceText}
              onChange={(event) => setSourceText(event.target.value)}
              placeholder={"бекон 3 кг\nмакароны 6 кг\nмед 5 кг"}
            />
          </div>

          <div className="smartOrderActions smartOrderActionsPrimary">
            <button
              type="button"
              className="primaryButton smartOrderMainButton"
              disabled={isRunning || isMatching || !sourceText.trim()}
              onClick={() => void handleRunSmartOrder()}
            >
              <Sparkles size={18} />
              <span>{isRunning ? "Собираем..." : "Сделать умный заказ"}</span>
            </button>

            <button
              type="button"
              className="secondaryButton"
              disabled={isRunning || isMatching || (!selectedOptimization && !sourceText.trim())}
              onClick={() => void handleMatchVariants()}
            >
              <Search size={16} />
              <span>{isMatching ? "Подбираем..." : "Подобрать варианты"}</span>
            </button>
          </div>
        </section>

        {aiParseTestSection}

        <section className="card smartOrderSummaryCard smartOrderSummaryCardStacked">
          <div className="smartOrderCardHeader">
            <h2 className="sectionTitle">Умный заказ</h2>

            <button
              type="button"
              className="secondaryButton compactButton"
              disabled={!smartOrderText || isCopying}
              onClick={() => void handleCopyOrder()}
            >
              <Copy size={15} />
              <span>{isCopying ? "Копируем..." : "Скопировать заказ"}</span>
            </button>
          </div>

          {smartOrderGroups.length === 0 ? (
            <p className="smartOrderHint">Вставьте список и нажмите кнопку.</p>
          ) : (
            <>
              <div className="smartOrderSupplierList">
                {smartOrderGroups.map((group) => (
                  <section key={group.supplierName} className="smartOrderSupplierBlock">
                    <div className="smartOrderSupplierTop">
                      <h3>{group.supplierName}</h3>
                      <strong>{group.totalText ?? "—"}</strong>
                    </div>

                    <div className="smartOrderSupplierRows">
                      {group.items.map((line) => (
                        <div key={line.item.id} className="smartOrderRow">
                          <div className="smartOrderRowMain">
                            <span className="smartOrderRowName">{line.productName}</span>
                          </div>
                          <span className="smartOrderRowMeta">{line.quantityText}</span>
                          <span className="smartOrderRowTotal">{line.totalText}</span>

                          <button
                            type="button"
                            className="smartOrderEditButton"
                            onClick={() => openPicker(line.item)}
                          >
                            <PencilLine size={14} />
                            <span>Изменить</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>

              <div className="smartOrderFooter">
                <span>Итого</span>
                <strong>{overallTotal ?? "—"}</strong>
              </div>

              {selectedOptimization?.baskets.length ? (
                <section className="smartOrderBasketsSection">
                  <div className="smartOrderCardHeader smartOrderCardHeaderSimple">
                    <div>
                      <h3 className="sectionTitle">Корзины поставщиков</h3>
                    </div>
                  </div>

                  <div className="smartOrderSupplierList">
                    {selectedOptimization.baskets.map((basket) => (
                      <section
                        key={`${basket.supplierId ?? "supplier"}-${basket.supplierName}`}
                        className="smartOrderSupplierBlock"
                      >
                        <div className="smartOrderSupplierTop">
                          <div className="smartOrderBasketHeader">
                            <h3>{basket.supplierName}</h3>
                            <div className="smartOrderBasketMeta">
                              <span>{basket.itemsCount} поз.</span>
                              <span>Сумма: {formatMoney(basket.total) ?? basket.total}</span>
                              <span>
                                Минималка:{" "}
                                {basket.minOrderAmount ? formatMoney(basket.minOrderAmount) : "не задана"}
                              </span>
                            </div>
                          </div>

                          <div className="smartOrderBasketActions">
                            <span
                              className={`statusPill smartOrderBasketStatus ${
                                !basket.minOrderAmount
                                  ? "smartOrderBasketStatusNeutral"
                                  : basket.meetsMinOrder
                                    ? "smartOrderBasketStatusOk"
                                    : "smartOrderBasketStatusWarning"
                              }`}
                            >
                              {getBasketStatusText(basket)}
                            </span>

                            <button
                              type="button"
                              className="secondaryButton compactButton"
                              disabled={copyingBasketSupplierName === basket.supplierName}
                              onClick={() => void handleCopyBasket(basket)}
                            >
                              <Copy size={15} />
                              <span>
                                {copyingBasketSupplierName === basket.supplierName
                                  ? "Копируем..."
                                  : "Скопировать заказ"}
                              </span>
                            </button>
                          </div>
                        </div>

                        <div className="smartOrderSupplierRows">
                          {basket.items.map((item) => (
                            <div key={item.itemId} className="smartOrderRow">
                              <div className="smartOrderRowMain">
                                <span className="smartOrderRowName">
                                  {item.selectedProductName || item.parsedName || "Товар"}
                                </span>
                                {item.selectedProductName && item.parsedName ? (
                                  <span className="smartOrderBasketParsedName">{item.parsedName}</span>
                                ) : null}
                              </div>
                              <span className="smartOrderRowMeta">{formatAmount(item.quantity, item.unit)}</span>
                              <span className="smartOrderRowTotal">
                                {formatMoney(item.optimizedLineTotal) ?? "—"}
                              </span>
                            </div>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          )}
        </section>

        {problemItems.length > 0 ? (
          <section className="card smartOrderProblemsCard">
            <div className="smartOrderCardHeader smartOrderCardHeaderSimple">
              <div>
                <h2 className="sectionTitle">Проблемные позиции</h2>
              </div>
              <span className="statusPill">{problemItems.length}</span>
            </div>

            <div className="smartOrderProblemList">
              {problemItems.map(({ item, candidate, reasons }) => (
                <section key={item.id} className="smartOrderProblemCard">
                  <div className="smartOrderProblemHeader">
                    <div className="smartOrderProblemMain">
                      <h3>{item.parsedName?.trim() || item.sourceLine}</h3>
                      <p>{formatAmount(item.parsedQuantity, item.parsedUnit)}</p>
                    </div>

                    <button
                      type="button"
                      className="smartOrderEditButton"
                      onClick={() => openPicker(item)}
                    >
                      <PencilLine size={14} />
                      <span>Изменить</span>
                    </button>
                  </div>

                  <div className="smartOrderProblemReasons">
                    {reasons.map((reason) => (
                      <span key={`${item.id}-${reason}`} className="statusPill smartOrderProblemReason">
                        {reason}
                      </span>
                    ))}
                  </div>

                  <div className="smartOrderProblemMeta">
                    <span>Товар: {candidate?.selectedProduct?.name ?? "не выбран"}</span>
                    <span>Поставщик: {candidate?.selectedSupplier?.name ?? "не выбран"}</span>
                    <span>Цена: {formatMoney(candidate?.optimizedLineTotal) ?? "не рассчитана"}</span>
                  </div>
                </section>
              ))}
            </div>
          </section>
        ) : null}

        <section className="smartOrderBenefits">
          <article className="card smartOrderBenefitCard">
            <span className="smartOrderBenefitIcon smartOrderBenefitIconBlue" aria-hidden="true">
              <Sparkles size={18} strokeWidth={2} />
            </span>
            <div className="smartOrderBenefitBody">
              <h3>Умный подбор</h3>
              <p>Находим лучшие предложения по цене и условиям поставки.</p>
            </div>
          </article>

          <article className="card smartOrderBenefitCard">
            <span className="smartOrderBenefitIcon smartOrderBenefitIconGreen" aria-hidden="true">
              <WalletCards size={18} strokeWidth={2} />
            </span>
            <div className="smartOrderBenefitBody">
              <h3>Экономия времени и денег</h3>
              <p>Сравниваем цены и фасовки, чтобы заказ был выгоднее.</p>
            </div>
          </article>
        </section>
      </div>

      {picker && pickerItem ? (
        <div className="smartOrderModalBackdrop" onClick={() => setPicker(null)} role="presentation">
          <div
            className="smartOrderModal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="smart-order-picker-title"
          >
            <div className="smartOrderModalHeader">
              <div>
                <h3 id="smart-order-picker-title">Заменить товар</h3>
                <p>{pickerItem.parsedName?.trim() || pickerItem.sourceLine}</p>
              </div>
              <button type="button" className="secondaryButton compactButton" onClick={() => setPicker(null)}>
                Закрыть
              </button>
            </div>

            <div className="smartOrderSearchField">
              <Search size={16} />
              <input
                value={picker.query}
                onChange={(event) =>
                  setPicker((current) => (current ? { ...current, query: event.target.value } : current))
                }
                placeholder="Начните вводить название товара"
              />
            </div>

            {isSearchLoading ? (
              <div className="emptyState smartOrderModalEmpty">
                <p className="emptyStateTitle">Ищем варианты...</p>
                <p className="emptyStateText">Результаты появятся автоматически.</p>
              </div>
            ) : filteredCandidates.length === 0 ? (
              <div className="emptyState smartOrderModalEmpty">
                <p className="emptyStateTitle">Ничего не найдено</p>
                <p className="emptyStateText">Попробуйте другой запрос.</p>
              </div>
            ) : (
              <div className="smartOrderModalResults">
                {filteredCandidates.map((result) => {
                  const isSelected = pickerItem.selectedCandidateId === result.id;
                  const quantityText = result.coverage?.suggestedPacksCount
                    ? `${result.coverage.suggestedPacksCount} уп`
                    : formatAmount(pickerItem.parsedQuantity, pickerItem.parsedUnit);
                  const unitText = result.selectedProduct?.unit ?? "—";
                  const packText = result.selectedProduct?.unitsPerPack
                    ? `${result.selectedProduct.unitsPerPack} ${unitText}`
                    : result.coverage?.packSize
                      ? `${result.coverage.packSize} ${pickerItem.parsedUnit ?? ""}`.trim()
                      : "—";

                  return (
                    <button
                      key={result.id}
                      type="button"
                      className={`smartOrderCandidateCard ${isSelected ? "smartOrderCandidateCardSelected" : ""}`}
                      disabled={Boolean(selectingCandidateId)}
                      onClick={() => void handleSelectCandidate(pickerItem, result)}
                    >
                      <div className="smartOrderCandidateHead">
                        <div>
                          <strong>{result.selectedProduct?.name ?? "Товар не найден"}</strong>
                          <span>{result.selectedSupplier?.name ?? "Поставщик не указан"}</span>
                        </div>
                        <strong>{formatMoney(result.optimizedLineTotal) ?? "—"}</strong>
                      </div>

                      <div className="smartOrderCandidateMeta">
                        <span>Цена: {formatMoney(result.optimizedUnitPrice) ?? "—"}</span>
                        <span>Ед.: {unitText}</span>
                        <span>Фасовка: {packText}</span>
                        <span>Купить: {quantityText}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
