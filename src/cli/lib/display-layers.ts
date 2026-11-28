/**
 * Display layers whose rows can't be told apart (opuspopuli#1475).
 *
 * Each display layer owns the rows of its jurisdictionType whose fips code
 * starts with its fipsPrefix. Two display layers of one type with
 * overlapping prefixes — equal, or one a prefix of the other ('' overlaps
 * everything) — claim the same rows, so the consumer leaves both out. JSON
 * Schema can't express a rule across array items, so it's checked here,
 * within a file and across a state and its counties (which the consumer
 * loads together).
 *
 * The consumer applies the same rule at load time
 * (opuspopuli `apps/backend/src/apps/region/src/domains/shapes/display-layers.ts`).
 * Change both together.
 */
interface LayerLike {
  jurisdictionType: string;
  fipsPrefix?: string;
  display?: { layerName: string };
}

/** One message per pair of display layers that claim the same rows. */
export function displayLayerClashes(configs: unknown[]): string[] {
  const layers = configs.flatMap((c) => {
    const tiger = (
      c as { config?: { boundarySources?: { tigerLayers?: LayerLike[] } } }
    )?.config?.boundarySources?.tigerLayers;
    return (tiger ?? []).filter((l) => l.display);
  });
  const clashes: string[] = [];
  layers.forEach((a, i) => {
    for (const b of layers.slice(i + 1)) {
      if (a.jurisdictionType !== b.jurisdictionType) continue;
      const pa = a.fipsPrefix ?? '';
      const pb = b.fipsPrefix ?? '';
      if (pa.startsWith(pb) || pb.startsWith(pa)) {
        clashes.push(
          `${a.jurisdictionType} display layers '${a.display?.layerName}' (fipsPrefix '${pa}') and ` +
            `'${b.display?.layerName}' (fipsPrefix '${pb}') claim the same rows — give each a distinct, ` +
            'non-overlapping fipsPrefix',
        );
      }
    }
  });
  return clashes;
}
