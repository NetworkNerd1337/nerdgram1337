/** Convert and generate both stop at 4 MiB. A diagram still stops at 2,000 nodes and 5,000 edges. */
export const CONVERT_MAX_INPUT_BYTES = 4 * 1024 * 1024;

export function translatorFail(status: number, message: string, code = "invalid"): Error {
  return Object.assign(new Error(message), { status, code });
}

export function assertConvertInputSize(bytes: number): void {
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw translatorFail(400, "The export size is not valid.");
  }
  if (bytes > CONVERT_MAX_INPUT_BYTES) {
    throw translatorFail(413, "The export is larger than 4 MiB.", "too_large");
  }
}
