// Browser-safe shared constants for the Google Drive connection.
export const DRIVE_CONNECTOR_ID = "google_drive";
export const DRIVE_FOLDER_NAME = "Billy";
export const GATEWAY_BASE_URL = "https://connector-gateway.lovable.dev";

/** Default folder name we look for when importing an Obsidian vault. */
export const VAULT_DEFAULT_FOLDER = "Obsidian";

export const DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/drive.file",
  // Needed to read the person's own Obsidian vault folder, which Billy did not create.
  "https://www.googleapis.com/auth/drive.readonly",
];
