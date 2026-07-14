import type { PrismaClient } from "@prisma/client";

export async function resolveSecondarySources(
  prisma: PrismaClient,
  events: Array<{ eventItems?: Array<{ itemId: string; role: string }> }>,
): Promise<Map<string, { sourceName: string; url: string | null }>> {
  const allSecondaryIds = events.flatMap(
    (e) =>
      (e.eventItems ?? [])
        .filter((ei) => ei.role === "SECONDARY")
        .map((ei) => ei.itemId),
  );

  if (allSecondaryIds.length === 0) {
    return new Map();
  }

  const secondaryItems = await prisma.item.findMany({
    where: { id: { in: allSecondaryIds } },
    select: {
      id: true,
      source: { select: { name: true, url: true } },
    },
  });

  return new Map(
    secondaryItems.map((item) => [
      item.id,
      { sourceName: item.source.name, url: item.source.url },
    ]),
  );
}
