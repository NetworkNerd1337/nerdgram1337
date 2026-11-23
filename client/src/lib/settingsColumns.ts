/**
 * Assign each card to the left (0) or right (1) column.
 * Order inside a column stays the source order. The split keeps the column
 * heights close, including the gap between cards, so a tall card does not
 * leave a large empty block at the bottom of the other column.
 */
export function packSettingsColumns(heights: readonly number[], gap = 0): number[] {
  const count = heights.length;
  if (count <= 1) return heights.map(() => 0);

  const columnHeight = (mask: number, column: 0 | 1): number => {
    let total = 0;
    let cards = 0;
    for (let index = 0; index < count; index += 1) {
      const onLeft = (mask & (1 << index)) !== 0;
      if (onLeft !== (column === 0)) continue;
      total += heights[index] ?? 0;
      if (cards > 0) total += gap;
      cards += 1;
    }
    return total;
  };

  if (count > 16) return greedyColumns(heights, gap);

  let bestMask = 1;
  let bestDiff = Number.POSITIVE_INFINITY;
  let bestCountGap = Number.POSITIVE_INFINITY;
  let bestFirst = 1;
  for (let mask = 1; mask < (1 << count) - 1; mask += 1) {
    const left = columnHeight(mask, 0);
    const right = columnHeight(mask, 1);
    const diff = Math.abs(left - right);
    let leftCount = 0;
    for (let index = 0; index < count; index += 1) {
      if ((mask & (1 << index)) !== 0) leftCount += 1;
    }
    const countGap = Math.abs(leftCount - (count - leftCount));
    const firstOnLeft = (mask & 1) !== 0 ? 0 : 1;
    const better =
      diff < bestDiff ||
      (diff === bestDiff && countGap < bestCountGap) ||
      (diff === bestDiff && countGap === bestCountGap && firstOnLeft < bestFirst) ||
      (diff === bestDiff && countGap === bestCountGap && firstOnLeft === bestFirst && mask < bestMask);
    if (!better) continue;
    bestMask = mask;
    bestDiff = diff;
    bestCountGap = countGap;
    bestFirst = firstOnLeft;
  }

  return Array.from({ length: count }, (_, index) => ((bestMask & (1 << index)) !== 0 ? 0 : 1));
}

function greedyColumns(heights: readonly number[], gap: number): number[] {
  const total = [0, 0];
  const cards = [0, 0];
  return heights.map((height) => {
    const column = total[0] <= total[1] ? 0 : 1;
    if (cards[column] > 0) total[column] += gap;
    total[column] += height;
    cards[column] += 1;
    return column;
  });
}

/** Height of one packed column, including the gap between its cards. */
export function settingsColumnHeight(heights: readonly number[], columns: readonly number[], column: 0 | 1, gap = 0): number {
  let total = 0;
  let cards = 0;
  heights.forEach((height, index) => {
    if (columns[index] !== column) return;
    if (cards > 0) total += gap;
    total += height;
    cards += 1;
  });
  return total;
}
