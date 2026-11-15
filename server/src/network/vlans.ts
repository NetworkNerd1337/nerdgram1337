/** `10,20,30,31,32,40` becomes `10,20,30-32,40`. Ids are sorted and de-duplicated first. */
export function compressVlans(ids: readonly number[]): string {
  const sorted = [...new Set(ids.filter((id) => Number.isInteger(id) && id >= 1 && id <= 4094))].sort((a, b) => a - b);
  const parts: string[] = [];
  let index = 0;
  while (index < sorted.length) {
    let end = index;
    while (end + 1 < sorted.length && sorted[end + 1] === (sorted[end] ?? 0) + 1) end += 1;
    const startId = sorted[index];
    const endId = sorted[end];
    if (startId == null || endId == null) break;
    parts.push(end === index ? String(startId) : `${startId}-${endId}`);
    index = end + 1;
  }
  return parts.join(",");
}
