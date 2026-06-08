type InvoiceProcessingPipelineInvoice = {
  invoiceNumber?: string | null;
  status?: string | null;
  items?: Array<{ needsReview?: boolean }>;
  priceChanges?: unknown[];
};

type InvoiceProcessingPipelineResponse = {
  message?: string;
  invoice?: InvoiceProcessingPipelineInvoice;
};

export type InvoiceProcessingPipelineResult = {
  invoiceId: string;
  invoiceNumber: string | null;
  status: string | null;
  itemsCount: number;
  reviewItemsCount: number;
  priceChangesCount: number;
  processingError: string | null;
};

type RunInvoiceProcessingPipelineParams = {
  invoiceId: string;
  enterpriseId: string;
  baseUrl?: string;
  cookieHeader?: string | null;
  fetchImpl?: typeof fetch;
};

async function parseJsonResponse<T>(response: Response) {
  return (await response.json().catch(() => null)) as T | null;
}

function buildHeaders(params: {
  cookieHeader?: string | null;
  contentType?: string;
}) {
  const headers = new Headers();

  if (params.contentType) {
    headers.set("Content-Type", params.contentType);
  }

  if (params.cookieHeader) {
    headers.set("cookie", params.cookieHeader);
  }

  return headers;
}

function buildUrl(baseUrl: string, pathname: string) {
  if (!baseUrl) {
    return pathname;
  }

  return `${baseUrl}${pathname}`;
}

export async function runInvoiceProcessingPipeline(
  params: RunInvoiceProcessingPipelineParams,
): Promise<InvoiceProcessingPipelineResult> {
  const { invoiceId, enterpriseId, baseUrl = "", cookieHeader = null, fetchImpl = fetch } = params;
  const query = new URLSearchParams({ enterpriseId });
  const processUrl = buildUrl(baseUrl, `/api/invoices/${invoiceId}/process?${query.toString()}`);
  const aiParseUrl = buildUrl(baseUrl, `/api/invoices/${invoiceId}/ai-parse?${query.toString()}`);
  const detectUrl = buildUrl(baseUrl, `/api/invoices/${invoiceId}/detect-price-changes`);
  const detailsUrl = buildUrl(baseUrl, `/api/invoices/${invoiceId}?${query.toString()}`);

  try {
    const processResponse = await fetchImpl(processUrl, {
      method: "POST",
      headers: buildHeaders({ cookieHeader }),
    });
    const processPayload = await parseJsonResponse<InvoiceProcessingPipelineResponse>(processResponse);

    if (!processResponse.ok) {
      throw new Error(processPayload?.message ?? "Не удалось распознать текст.");
    }

    const aiResponse = await fetchImpl(aiParseUrl, {
      method: "POST",
      headers: buildHeaders({ cookieHeader }),
    });
    const aiPayload = await parseJsonResponse<InvoiceProcessingPipelineResponse>(aiResponse);

    if (!aiResponse.ok) {
      throw new Error(aiPayload?.message ?? "AI не нашёл товары.");
    }

    const detectResponse = await fetchImpl(detectUrl, {
      method: "POST",
      headers: buildHeaders({
        cookieHeader,
        contentType: "application/json",
      }),
      body: JSON.stringify({
        enterpriseId,
      }),
    });
    const detectPayload = await parseJsonResponse<InvoiceProcessingPipelineResponse>(detectResponse);

    if (!detectResponse.ok) {
      throw new Error(detectPayload?.message ?? "Не удалось проверить изменения цен.");
    }

    const detailsResponse = await fetchImpl(detailsUrl, {
      cache: "no-store",
      headers: buildHeaders({ cookieHeader }),
    });
    const detailsPayload = await parseJsonResponse<InvoiceProcessingPipelineResponse>(detailsResponse);

    if (!detailsResponse.ok || !detailsPayload?.invoice) {
      throw new Error(detailsPayload?.message ?? "Не удалось обновить данные накладной.");
    }

    const invoice = detailsPayload.invoice;
    const itemsCount = invoice.items?.length ?? 0;
    const reviewItemsCount = invoice.items?.filter((item) => item.needsReview).length ?? 0;
    const priceChangesCount = invoice.priceChanges?.length ?? 0;

    return {
      invoiceId,
      invoiceNumber: invoice.invoiceNumber ?? null,
      status: invoice.status ?? null,
      itemsCount,
      reviewItemsCount,
      priceChangesCount,
      processingError: null,
    };
  } catch (error) {
    return {
      invoiceId,
      invoiceNumber: null,
      status: null,
      itemsCount: 0,
      reviewItemsCount: 0,
      priceChangesCount: 0,
      processingError: error instanceof Error ? error.message : "Не удалось обработать накладную.",
    };
  }
}
