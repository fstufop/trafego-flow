import { MediaUploadStatus } from '../enums/media-upload-status.enum.js';
import { MediaUploadLog } from '../entities/media-upload-log.entity.js';

export interface UploadInitiatedResult {
  logId: string;
  mediaName: string;
  driveUrl: string;
  status: MediaUploadStatus;
}

export interface PaginatedLogs {
  data: MediaUploadLog[];
  total: number;
  page: number;
  limit: number;
}
