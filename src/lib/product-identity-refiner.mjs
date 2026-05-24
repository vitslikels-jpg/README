const MAX_BRAND_CANDIDATE_WORDS = 4;

const COUNTRY_ALIASES = new Map([
  ["россия", "РОССИЯ"],
  ["рф", "РОССИЯ"],
  ["russia", "РОССИЯ"],
  ["таиланд", "ТАИЛАНД"],
  ["тайланд", "ТАИЛАНД"],
  ["thailand", "ТАИЛАНД"],
  ["вьетнам", "ВЬЕТНАМ"],
  ["vietnam", "ВЬЕТНАМ"],
  ["индонезия", "ИНДОНЕЗИЯ"],
  ["indonesia", "ИНДОНЕЗИЯ"],
  ["италия", "ИТАЛИЯ"],
  ["italy", "ИТАЛИЯ"],
  ["italia", "ИТАЛИЯ"],
  ["китай", "КИТАЙ"],
  ["china", "КИТАЙ"],
  ["кнр", "КИТАЙ"],
  ["индия", "ИНДИЯ"],
  ["india", "ИНДИЯ"],
  ["япония", "ЯПОНИЯ"],
  ["japan", "ЯПОНИЯ"],
  ["корея", "КОРЕЯ"],
  ["ю. корея", "ЮЖНАЯ КОРЕЯ"],
  ["южная корея", "ЮЖНАЯ КОРЕЯ"],
  ["корея южная", "ЮЖНАЯ КОРЕЯ"],
  ["south korea", "ЮЖНАЯ КОРЕЯ"],
  ["republic of korea", "ЮЖНАЯ КОРЕЯ"],
  ["сша", "США"],
  ["usa", "США"],
  ["united states", "США"],
  ["тайвань", "ТАЙВАНЬ"],
  ["taiwan", "ТАЙВАНЬ"],
]);

const NON_BRAND_TERMS = new Set([
  "без бренда и страны",
  "без бренда",
  "без страны",
  "китай",
  "корея",
  "южная корея",
  "япония",
  "таиланд",
  "тайвань",
  "индонезия",
  "вьетнам",
  "сша",
  "hot",
  "mild",
  "big bowl",
  "plain noodles",
  "stir fry",
  "spicy",
]);

function normalizeComparableText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/gu, " ");
}

function normalizeOptionalText(value) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function normalizeCountryToken(value) {
  return normalizeComparableText(value).replace(/[).,;:!?]+$/gu, "").trim();
}

function looksLikeCountry(value) {
  const normalized = normalizeCountryToken(value);
  return COUNTRY_ALIASES.has(normalized);
}

function toDisplayCountry(value) {
  return COUNTRY_ALIASES.get(normalizeCountryToken(value)) ?? String(value ?? "").trim().toUpperCase();
}

function stripPackagingHints(value) {
  return String(value ?? "")
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:кг|г|гр|л|л\.|мл|шт|листов|порций)\b/giu, " ")
    .replace(/\bж\/б\b/giu, " ")
    .replace(/\(\s*\d+\s*шт\s*\)/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function splitNameBySemanticCommas(value) {
  const decimalCommaPlaceholder = "__DECIMAL_COMMA__";

  return String(value ?? "")
    .replace(/(?<=\d),\s*(?=\d)/gu, decimalCommaPlaceholder)
    .split(",")
    .map((part) => part.replaceAll(decimalCommaPlaceholder, ",").trim())
    .filter(Boolean);
}

function countWords(value) {
  return String(value ?? "")
    .trim()
    .split(/\s+/u)
    .filter(Boolean).length;
}

function hasLatinLetters(value) {
  return /[A-Za-z]/u.test(String(value ?? ""));
}

function hasBrandSignalWord(value) {
  return String(value ?? "")
    .split(/\s+/u)
    .filter(Boolean)
    .some(
      (word) =>
        /^[A-Z]{2,}[A-Za-z0-9.&'’`/\-]*$/u.test(word) ||
        /^[A-Z][A-Za-z0-9.&'’`/\-]*$/u.test(word) ||
        /^[A-Z]-[A-Za-z0-9.&'’`/-]+$/u.test(word),
    );
}

function hasLowercaseLatinBrandSignal(value) {
  return String(value ?? "")
    .split(/\s+/u)
    .filter(Boolean)
    .every((word) => /^[a-z][a-z0-9.&'’`/\-]{3,}$/u.test(word));
}

function isPackagingLikeText(value) {
  return /\b\d+(?:[.,]\d+)?\s*(?:кг|г|гр|л|л\.|мл|шт|листов|порций)\b/iu.test(String(value ?? ""));
}

function isPotentialBrandCandidate(value) {
  const candidate = normalizeOptionalText(value);

  if (!candidate) {
    return false;
  }

  if (NON_BRAND_TERMS.has(normalizeComparableText(candidate))) {
    return false;
  }

  if (looksLikeCountry(candidate) || isPackagingLikeText(candidate)) {
    return false;
  }

  if (/[A-Za-z]/u.test(candidate) && /[А-Яа-яЁё]/u.test(candidate)) {
    return false;
  }

  const wordCount = countWords(candidate);

  if (wordCount === 0 || wordCount > MAX_BRAND_CANDIDATE_WORDS) {
    return false;
  }

  if (hasLatinLetters(candidate) && hasBrandSignalWord(candidate)) {
    return true;
  }

  if (hasLatinLetters(candidate) && hasLowercaseLatinBrandSignal(candidate)) {
    return true;
  }

  return /^[A-ZА-ЯЁ][A-ZА-ЯЁ0-9'’`/&.\-]*(?:\s+[A-ZА-ЯЁ][A-ZА-ЯЁ0-9'’`/&.\-]*){0,2}$/u.test(candidate);
}

function dedupeCandidates(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const candidate = normalizeOptionalText(value);

    if (!candidate) {
      continue;
    }

    const key = normalizeComparableText(candidate);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(candidate);
  }

  return result;
}

function buildQuotedBrandCandidates(rawName) {
  const source = String(rawName ?? "").replace(/[«»„“”]/gu, "\"");
  const matches = [...source.matchAll(/"([^"]+)"/gu)];
  const candidates = [];

  for (const match of matches) {
    const candidate = normalizeOptionalText(match[1]);

    if (candidate && isPotentialBrandCandidate(candidate)) {
      candidates.push(candidate);
    }
  }

  return dedupeCandidates(candidates);
}

function buildBrandAfterQuotedCandidates(rawName) {
  const source = String(rawName ?? "").replace(/[«»„“”]/gu, "\"");
  const matches = [...source.matchAll(/"[^"]+"/gu)];
  const candidates = [];

  for (const match of matches) {
    if (match.index === undefined) {
      continue;
    }

    const tail = source.slice(match.index + match[0].length);
    const tailMatch = tail.match(
      /^\s*([A-Z][A-Za-z0-9.&'’`/\-]*(?:\s+(?:[A-Z][A-Za-z0-9.&'’`/\-]*|[a-z][A-Za-z0-9.&'’`/\-]*)){0,3})(?=,?\s*(?:ж\/б\s*)?\d+(?:[.,]\d+)?\s*(?:кг|г|гр|л|л\.|мл|шт)\b)/u,
    );

    if (tailMatch?.[1] && isPotentialBrandCandidate(tailMatch[1])) {
      candidates.push(tailMatch[1]);
    }
  }

  return dedupeCandidates(candidates);
}

function buildLowercaseTailBrandCandidates(rawName) {
  const source = String(rawName ?? "");
  const matches = [
    ...source.matchAll(
      /([A-Za-z][A-Za-z0-9.&'’`/\-]*(?:\s+[A-Za-z][A-Za-z0-9.&'’`/\-]*){0,2})\s*,?\s*(?:ж\/б\s*)?\d+(?:[.,]\d+)?\s*(?:кг|г|гр|л|л\.|мл|шт)\b/gu,
    ),
  ];
  const candidates = [];

  for (const match of matches) {
    const candidate = normalizeOptionalText(match[1]);

    if (!candidate || !isPotentialBrandCandidate(candidate) || match.index === undefined) {
      continue;
    }

    candidates.push(candidate);
  }

  return dedupeCandidates(candidates);
}

function buildBrandCandidates(rawName) {
  const compactName = normalizeOptionalText(rawName) ?? "";
  const candidates = [];
  const commaParts = splitNameBySemanticCommas(compactName);

  if (commaParts.length > 1) {
    for (const part of commaParts) {
      if (isPotentialBrandCandidate(part)) {
        candidates.push(part);
      }
    }
  }

  const noPackaging = stripPackagingHints(compactName);
  const withoutCountry = splitNameBySemanticCommas(noPackaging).filter((part) => !looksLikeCountry(part)).join(", ");
  const compactWithoutCountry = withoutCountry.replace(/[,\s]+$/gu, "").trim();
  candidates.push(...buildBrandAfterQuotedCandidates(compactName));
  const afterMeasureTailMatch = compactName.match(
    /(?:кг|г|гр|л|л\.|мл|шт)\s+([A-Z][A-Za-z0-9.&'’`/\-]*(?:\s+(?:[A-Z][A-Za-z0-9.&'’`/\-]*|[a-z][A-Za-z0-9.&'’`/\-]*)){0,3}|[a-z][a-z0-9.&'’`/\-]{3,}(?:\s+[a-z][a-z0-9.&'’`/\-]{3,}){0,2})$/u,
  );

  if (afterMeasureTailMatch?.[1] && isPotentialBrandCandidate(afterMeasureTailMatch[1])) {
    candidates.push(afterMeasureTailMatch[1]);
  }

  const postQuotedBeforeMeasureMatch = compactName.match(
    /"[^"]+"\s+([A-Z][A-Za-z0-9.&'’`/\-]*(?:\s+(?:[A-Z][A-Za-z0-9.&'’`/\-]*|[a-z][A-Za-z0-9.&'’`/\-]*)){0,3})(?=,?\s*(?:ж\/б\s*)?\d+(?:[.,]\d+)?\s*(?:кг|г|гр|л|л\.|мл|шт)\b)/u,
  );

  if (postQuotedBeforeMeasureMatch?.[1] && isPotentialBrandCandidate(postQuotedBeforeMeasureMatch[1])) {
    candidates.push(postQuotedBeforeMeasureMatch[1]);
  }

  candidates.push(...buildQuotedBrandCandidates(compactName));

  const beforeMeasureMatch = compactName.match(
    /(?:^|[\s,(])([A-Z][A-Za-z0-9.&'’`/\-]*(?:\s+(?:[A-Z][A-Za-z0-9.&'’`/\-]*|[a-z][A-Za-z0-9.&'’`/\-]*)){0,3})(?=,?\s*(?:ж\/б\s*)?\d+(?:[.,]\d+)?\s*(?:кг|г|гр|л|л\.|мл|шт)\b)/u,
  );

  if (beforeMeasureMatch?.[1] && isPotentialBrandCandidate(beforeMeasureMatch[1])) {
    candidates.push(beforeMeasureMatch[1]);
  }

  const titleCaseBeforeMeasureMatch = compactName.match(
    /([A-Z][A-Za-z0-9.&'’`/\-]*(?:\s+[A-Z][A-Za-z0-9.&'’`/\-]*){1,3})(?=,?\s*(?:ж\/б\s*)?\d+(?:[.,]\d+)?\s*(?:кг|г|гр|л|л\.|мл|шт)\b)/u,
  );

  if (titleCaseBeforeMeasureMatch?.[1] && isPotentialBrandCandidate(titleCaseBeforeMeasureMatch[1])) {
    candidates.push(titleCaseBeforeMeasureMatch[1]);
  }

  candidates.push(...buildLowercaseTailBrandCandidates(compactName));

  const trailingMatch = compactWithoutCountry.match(
    /(?:^|[\s,(])([A-Z][A-Za-z0-9.&'’`/\-]*(?:\s+(?:[A-Z][A-Za-z0-9.&'’`/\-]*|[a-z][A-Za-z0-9.&'’`/\-]*)){0,3})$/u,
  );

  if (trailingMatch?.[1] && isPotentialBrandCandidate(trailingMatch[1])) {
    candidates.push(trailingMatch[1]);
  }

  const leadingMatch = compactWithoutCountry.match(
    /^([A-Z][A-Za-z0-9.&'’`/\-]*(?:\s+(?:[A-Z][A-Za-z0-9.&'’`/\-]*|[a-z][A-Za-z0-9.&'’`/\-]*)){0,3})(?=\s)/u,
  );

  if (leadingMatch?.[1] && isPotentialBrandCandidate(leadingMatch[1])) {
    candidates.push(leadingMatch[1]);
  }

  const lowerCaseLeadingMatch = compactWithoutCountry.match(
    /^([a-z][a-z0-9.&'’`/\-]{3,}(?:\s+[a-z][a-z0-9.&'’`/\-]{3,}){0,2})(?=\s)/u,
  );

  if (lowerCaseLeadingMatch?.[1] && isPotentialBrandCandidate(lowerCaseLeadingMatch[1])) {
    candidates.push(lowerCaseLeadingMatch[1]);
  }

  const embeddedMatches = compactWithoutCountry.matchAll(
    /(?:^|[\s,(])([A-Z][A-Za-z0-9.&'’`/\-]*(?:\s+(?:[A-Z][A-Za-z0-9.&'’`/\-]*|[a-z][A-Za-z0-9.&'’`/\-]*)){0,3})(?=[\s,)]|$)/gu,
  );

  for (const match of embeddedMatches) {
    if (match[1] && isPotentialBrandCandidate(match[1])) {
      candidates.push(match[1]);
    }
  }

  return dedupeCandidates(candidates);
}

function selectPreferredBrandCandidate(rawName, candidates) {
  if (candidates.length === 0) {
    return null;
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  const candidatesWithoutDigits = candidates.filter((candidate) => !/\d/.test(candidate));
  const pool = candidatesWithoutDigits.length > 0 ? candidatesWithoutDigits : candidates;
  const commaParts = splitNameBySemanticCommas(rawName);
  const tail = commaParts[commaParts.length - 1] ?? "";
  const quotedTailMatch = rawName.match(
    /"[^"]+"\s+([A-Z][A-Za-z0-9.&'’`/\-]*(?:\s+(?:[A-Z][A-Za-z0-9.&'’`/\-]*|[a-z][A-Za-z0-9.&'’`/\-]*)){0,3})(?=,?\s*(?:ж\/б\s*)?\d+(?:[.,]\d+)?\s*(?:кг|г|гр|л|л\.|мл|шт)\b)/u,
  );

  if (quotedTailMatch?.[1]) {
    const exactPostQuoted = pool.find(
      (candidate) => normalizeComparableText(candidate) === normalizeComparableText(quotedTailMatch[1]),
    );

    if (exactPostQuoted) {
      return exactPostQuoted;
    }
  }

  const trailingMatches = pool.filter((candidate) => normalizeComparableText(tail).includes(normalizeComparableText(candidate)));

  if (trailingMatches.length === 1) {
    return trailingMatches[0];
  }

  if (trailingMatches.length > 1) {
    return trailingMatches.sort((left, right) => right.length - left.length)[0];
  }

  const afterMeasureTailMatch = rawName.match(
    /(?:кг|г|гр|л|л\.|мл|шт)\s+([A-Z][A-Za-z0-9.&'’`/\-]*(?:\s+(?:[A-Z][A-Za-z0-9.&'’`/\-]*|[a-z][A-Za-z0-9.&'’`/\-]*)){0,3}|[a-z][a-z0-9.&'’`/\-]{3,}(?:\s+[a-z][a-z0-9.&'’`/\-]{3,}){0,2})$/u,
  );

  if (afterMeasureTailMatch?.[1]) {
    const exactAfterMeasureTail = pool.find(
      (candidate) => normalizeComparableText(candidate) === normalizeComparableText(afterMeasureTailMatch[1]),
    );

    if (exactAfterMeasureTail) {
      return exactAfterMeasureTail;
    }
  }

  const longCandidates = pool.filter((candidate) => countWords(candidate) > 1);

  if (longCandidates.length === 1) {
    return longCandidates[0];
  }

  return pool.sort((left, right) => right.length - left.length)[0];
}

function stripBrandFromName(name, brand) {
  const sourceName = normalizeOptionalText(name);
  const sourceBrand = normalizeOptionalText(brand);

  if (!sourceName || !sourceBrand) {
    return sourceName ?? "";
  }

  const escapedBrand = sourceBrand.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  let nextName = sourceName
    .replace(new RegExp(`^${escapedBrand}(?:\\s+|\\s*,\\s*)`, "iu"), "")
    .replace(new RegExp(`(?:\\s*,\\s*|\\s+)${escapedBrand}$`, "iu"), "")
    .replace(new RegExp(`(?:^|\\s)${escapedBrand}(?=\\s*,\\s*\\d|\\s+\\d|\\s*$)`, "iu"), " ")
    .replace(/\s+,/gu, ",")
    .replace(/\s{2,}/gu, " ")
    .replace(/^[,\s]+|[,\s]+$/gu, "")
    .trim();

  if (!nextName) {
    nextName = sourceName;
  }

  return nextName;
}

function clampConfidence(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return null;
  }

  if (numericValue < 0) {
    return 0;
  }

  if (numericValue > 1) {
    return 1;
  }

  return numericValue;
}

function joinApiUrl(baseUrl, path) {
  return `${baseUrl.replace(/\/+$/u, "")}/${path.replace(/^\/+/u, "")}`;
}

function getRemoteAiProvider() {
  const polzaApiKey = process.env.POLZA_AI_API_KEY?.trim();

  if (polzaApiKey) {
    return {
      source: "polza",
      apiKey: polzaApiKey,
      model: process.env.POLZA_AI_MODEL?.trim() || "qwen/qwen3.6-flash",
      completionsUrl: joinApiUrl(process.env.POLZA_AI_BASE_URL?.trim() || "https://polza.ai/api/v1", "chat/completions"),
      headers: {},
    };
  }

  const openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim();

  if (!openRouterApiKey) {
    return null;
  }

  return {
    source: "openrouter",
    apiKey: openRouterApiKey,
    model: process.env.OPENROUTER_MODEL?.trim() || "openai/gpt-4o-mini",
    completionsUrl: joinApiUrl(
      process.env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1",
      "chat/completions",
    ),
    headers: {
      "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "http://localhost",
      "X-Title": "Citadel Prices",
    },
  };
}

function normalizeAiSuggestion(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const suggestion = value;
  const parsedName = normalizeOptionalText(suggestion.parsedName);
  const brand = normalizeOptionalText(suggestion.brand);
  const country = normalizeOptionalText(suggestion.country);

  return {
    parsedName,
    brand,
    country: country && looksLikeCountry(country) ? toDisplayCountry(country) : country,
    confidence: clampConfidence(suggestion.confidence),
    explanation: normalizeOptionalText(suggestion.explanation),
  };
}

function shouldRequestAi(input, brandCandidates) {
  if (!normalizeOptionalText(input.rawName) || input.disableAi) {
    return false;
  }

  if (brandCandidates.length >= 2) {
    return true;
  }

  if (!input.brand && brandCandidates.length >= 1) {
    return true;
  }

  if (!input.brand && hasLatinLetters(input.rawName)) {
    return true;
  }

  if (input.brand && brandCandidates.some((candidate) => normalizeComparableText(candidate) !== normalizeComparableText(input.brand))) {
    return true;
  }

  if (!input.country && looksLikeCountry(input.rawName)) {
    return true;
  }

  return false;
}

async function requestAiRefinement(input, brandCandidates) {
  const provider = getRemoteAiProvider();

  if (!provider) {
    return null;
  }

  try {
    const response = await fetch(provider.completionsUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
        ...provider.headers,
      },
      body: JSON.stringify({
        model: provider.model,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Ты помогаешь разбирать товарную строку прайса. Верни только JSON с полями parsedName, brand, country, confidence, explanation. Бренд может стоять в начале, середине или конце строки. Не придумывай бренд, если его нет. Не используй вкус, линейку, персонажа или подзаголовок как бренд, если это не бренд. Страну возвращай только если уверен. confidence от 0 до 1. explanation коротко по-русски.",
          },
          {
            role: "user",
            content: JSON.stringify({
              supplierName: input.supplierName,
              rawName: input.rawName,
              currentParsedName: input.parsedName,
              currentBrand: input.brand,
              currentCountry: input.country,
              rawBrandColumn: input.rawBrand,
              rawCountryColumn: input.rawCountry,
              localBrandCandidates: brandCandidates,
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      return null;
    }

    const suggestion = normalizeAiSuggestion(JSON.parse(content));

    if (!suggestion) {
      return null;
    }

    return {
      ...suggestion,
      source: provider.source,
    };
  } catch {
    return null;
  }
}

export async function refineParsedProductIdentity(input) {
  let nextName = normalizeOptionalText(input.parsedName) ?? normalizeOptionalText(input.rawName) ?? "";
  let nextBrand = normalizeOptionalText(input.brand);
  let nextCountry = normalizeOptionalText(input.country);
  const directCountry = normalizeOptionalText(input.rawCountry);

  if (!nextCountry && directCountry && looksLikeCountry(directCountry)) {
    nextCountry = toDisplayCountry(directCountry);
  }

  if (!nextCountry) {
    const embeddedCountry = splitNameBySemanticCommas(input.rawName).find((part) => looksLikeCountry(part));

    if (embeddedCountry) {
      nextCountry = toDisplayCountry(embeddedCountry);
      nextName = nextName
        .replace(new RegExp(`(?:\\s*,\\s*|\\s+)${embeddedCountry.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?=\\s*,|\\s*$)`, "iu"), " ")
        .replace(/\s+,/gu, ",")
        .replace(/\s{2,}/gu, " ")
        .replace(/^[,\s]+|[,\s]+$/gu, "")
        .trim();
    }
  }

  const brandCandidates = buildBrandCandidates(input.rawName);

  if (!nextBrand && brandCandidates.length === 1) {
    nextBrand = brandCandidates[0];
    nextName = stripBrandFromName(nextName, nextBrand);
  }

  if (!nextBrand && brandCandidates.length > 1) {
    const preferredCandidate = selectPreferredBrandCandidate(input.rawName, brandCandidates);

    if (preferredCandidate) {
      nextBrand = preferredCandidate;
      nextName = stripBrandFromName(nextName, nextBrand);
    }
  }

  if (shouldRequestAi(input, brandCandidates)) {
    const suggestion = await requestAiRefinement(input, brandCandidates);

    if (suggestion?.brand && (suggestion.confidence ?? 0) >= 0.55) {
      nextBrand = suggestion.brand;
    }

    if (suggestion?.country && !nextCountry && (suggestion.confidence ?? 0) >= 0.55) {
      nextCountry = suggestion.country;
    }

    if (suggestion?.parsedName && (suggestion.confidence ?? 0) >= 0.55) {
      nextName = suggestion.parsedName;
    } else if (suggestion?.brand) {
      nextName = stripBrandFromName(nextName, suggestion.brand);
    }

    return {
      name: normalizeOptionalText(nextName) ?? normalizeOptionalText(input.parsedName) ?? normalizeOptionalText(input.rawName) ?? "",
      brand: nextBrand,
      country: nextCountry,
      source: suggestion?.source ?? "local",
      confidence: suggestion?.confidence ?? null,
      explanation: suggestion?.explanation ?? null,
      usedAi: Boolean(suggestion),
    };
  }

  return {
    name: normalizeOptionalText(nextName) ?? normalizeOptionalText(input.parsedName) ?? normalizeOptionalText(input.rawName) ?? "",
    brand: nextBrand,
    country: nextCountry,
    source: nextBrand && brandCandidates.length === 1 ? "local" : "parser",
    confidence: nextBrand && brandCandidates.length === 1 ? 0.7 : null,
    explanation: nextBrand && brandCandidates.length === 1 ? "Локально найден один сильный кандидат бренда." : null,
    usedAi: false,
  };
}

export function debugBuildBrandCandidates(rawName) {
  return buildBrandCandidates(rawName);
}
