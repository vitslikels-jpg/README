"use client";

import { useState } from "react";

type ModelResult = {
  model: string;
  elapsedMs: number;
  brandCandidates: string[];
  result: null | {
    parsedName: string | null;
    brand: string | null;
    country: string | null;
    confidence: number | null;
    explanation: string | null;
    source: string;
  };
};

type ComparisonResponse = {
  results: ModelResult[];
};

type AiModelComparisonToolProps = {
  defaultModel: string;
};

const DEFAULT_MODELS = [
  "google/gemini-3.1-flash-lite",
  "openai/gpt-4o-mini",
  "deepseek/deepseek-v4-flash",
];

export function AiModelComparisonTool({ defaultModel }: AiModelComparisonToolProps) {
  const [rawName, setRawName] = useState("Арахис жаренный с сычуанским перцем Yuxianshen, 90 г");
  const [rawCountry, setRawCountry] = useState("КИТАЙ");
  const [rawBrand, setRawBrand] = useState("");
  const [supplierName, setSupplierName] = useState("Красный Дракон");
  const [modelsText, setModelsText] = useState(
    Array.from(new Set([defaultModel, ...DEFAULT_MODELS].filter(Boolean))).join("\n"),
  );
  const [results, setResults] = useState<ModelResult[]>([]);
  const [errorText, setErrorText] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function runComparison() {
    const models = modelsText
      .split(/\r?\n/u)
      .map((value) => value.trim())
      .filter(Boolean);

    if (!rawName.trim()) {
      setErrorText("Вставь строку товара.");
      return;
    }

    if (models.length === 0) {
      setErrorText("Добавь хотя бы одну модель.");
      return;
    }

    setIsLoading(true);
    setErrorText("");

    try {
      const response = await fetch("/api/settings/ai-model-comparison", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          rawName,
          rawCountry,
          rawBrand,
          supplierName,
          models,
        }),
      });

      const data = (await response.json().catch(() => null)) as ComparisonResponse | { message?: string } | null;

      if (!response.ok) {
        setResults([]);
        setErrorText(data && "message" in data && data.message ? data.message : "Не удалось сравнить модели.");
        return;
      }

      setResults((data as ComparisonResponse).results ?? []);
    } catch {
      setResults([]);
      setErrorText("Сравнение моделей упало.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="card settingsComparisonCard">
      <div className="cardHeader">
        <div>
          <p className="panelEyebrow">AI</p>
          <h2 className="sectionTitle">Сравнение Моделей</h2>
          <p className="panelText">
            Вставляешь одну строку из прайса и сразу видишь, как каждая модель вытаскивает бренд, страну и очищенное имя.
          </p>
        </div>
      </div>

      <div className="formGrid">
        <label className="field">
          <span>Строка товара</span>
          <textarea
            className="fieldTextarea"
            rows={4}
            value={rawName}
            onChange={(event) => setRawName(event.target.value)}
            placeholder="Название из прайса"
          />
        </label>

        <label className="field">
          <span>Страна</span>
          <input value={rawCountry} onChange={(event) => setRawCountry(event.target.value)} placeholder="КИТАЙ" />
        </label>

        <label className="field">
          <span>Бренд из колонки</span>
          <input value={rawBrand} onChange={(event) => setRawBrand(event.target.value)} placeholder="Если есть" />
        </label>

        <label className="field">
          <span>Поставщик</span>
          <input value={supplierName} onChange={(event) => setSupplierName(event.target.value)} />
        </label>

        <label className="field">
          <span>Модели, по одной в строке</span>
          <textarea className="fieldTextarea" rows={6} value={modelsText} onChange={(event) => setModelsText(event.target.value)} />
        </label>
      </div>

      <div className="settingsComparisonActions">
        <button className="primaryButton" type="button" onClick={() => void runComparison()} disabled={isLoading}>
          {isLoading ? "Сравниваю..." : "Сравнить"}
        </button>
      </div>

      {errorText ? <p className="errorText">{errorText}</p> : null}

      <div className="settingsComparisonGrid">
        {results.map((item) => (
          <article key={item.model} className="settingsComparisonResult">
            <div className="settingsComparisonResultHeader">
              <strong>{item.model}</strong>
              <span className="statusPill">{item.elapsedMs} мс</span>
            </div>
            <p>
              <strong>Бренд:</strong> {item.result?.brand ?? "null"}
            </p>
            <p>
              <strong>Страна:</strong> {item.result?.country ?? "null"}
            </p>
            <p>
              <strong>Очищенное имя:</strong> {item.result?.parsedName ?? "null"}
            </p>
            <p>
              <strong>Confidence:</strong> {item.result?.confidence ?? "null"}
            </p>
            <p>
              <strong>Пояснение:</strong> {item.result?.explanation ?? "—"}
            </p>
            <p>
              <strong>Локальные кандидаты:</strong> {item.brandCandidates.join(", ") || "—"}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
