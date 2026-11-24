/** Stable heading in docs/troubleshooting.md. The dialog and doctor share this URL. */
export const CLOUD_SYNC_DOCS_URL =
  "https://github.com/NetworkNerd1337/NerdGram1337/blob/main/docs/troubleshooting.md#why-cloud-synced-folders-are-unsupported";

export const CLOUD_SYNC_DOCS_LINK_TEXT = "Why cloud-synced folders are unsupported";

/**
 * One wording for the data-folder dialog, the startup log, and `nerdgram doctor`.
 * The dialog turns the URL into a link. Logs and doctor keep the URL in plain text.
 */
export function syncFolderMessage(reasons: string): string {
  return `NerdGram checked the data folder and found it looks synced or shared (${reasons}). NerdGram does not support cloud-synced folders such as OneDrive, iCloud Drive, Dropbox, or Google Drive for diagram libraries. To share a diagram library, use a real shared folder, such as an SMB (Samba or Windows file share) or NFS share. Move it to a local folder or a Docker volume for one machine, and use GitHub sync to share diagrams. ${CLOUD_SYNC_DOCS_LINK_TEXT}: ${CLOUD_SYNC_DOCS_URL}`;
}
