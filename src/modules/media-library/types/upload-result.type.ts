export interface UploadResult {
  fileName: string;
  driveFileId?: string;
  driveUrl?: string;
  metaAssetId?: string;
  errors: { destination: 'drive' | 'meta'; message: string }[];
}
