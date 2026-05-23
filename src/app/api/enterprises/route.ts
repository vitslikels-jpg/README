import { jsonUtf8 } from "@/lib/http";
import { getDatabaseSetupMessage, isDatabaseConfigured } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export async function GET() {
  if (!isDatabaseConfigured()) {
    return jsonUtf8({ message: getDatabaseSetupMessage() }, { status: 500 });
  }

  const enterprises = await prisma.enterprise.findMany({
    orderBy: {
      createdAt: "desc",
    },
  });

  return jsonUtf8(enterprises);
}

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) {
    return jsonUtf8({ message: getDatabaseSetupMessage() }, { status: 500 });
  }

  const body = (await request.json()) as {
    name?: string;
    address?: string;
    phone?: string;
  };

  const name = body.name?.trim();
  const address = body.address?.trim();
  const phone = body.phone?.trim();

  if (!name || !address || !phone) {
    return jsonUtf8(
      { message: "Поля name, address и phone обязательны." },
      { status: 400 },
    );
  }

  const enterprise = await prisma.enterprise.create({
    data: {
      name,
      address,
      phone,
    },
  });

  return jsonUtf8(enterprise, { status: 201 });
}
