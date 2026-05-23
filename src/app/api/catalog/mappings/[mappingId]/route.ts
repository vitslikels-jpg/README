import { jsonUtf8 } from "@/lib/http";
import { revokeManualProductMapping } from "@/lib/product-catalog";

type RouteContext = {
  params: Promise<{
    mappingId: string;
  }>;
};

export async function DELETE(_: Request, context: RouteContext) {
  const { mappingId } = await context.params;

  try {
    const result = await revokeManualProductMapping(mappingId);
    return jsonUtf8(result);
  } catch (error) {
    return jsonUtf8(
      { message: error instanceof Error ? error.message : "Не удалось отменить manual mapping." },
      { status: 400 },
    );
  }
}
