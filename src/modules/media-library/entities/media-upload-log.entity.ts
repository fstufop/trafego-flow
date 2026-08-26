import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/database/base.entity.js';
import { MediaUploadStatus } from '../enums/media-upload-status.enum.js';

@Entity('media_upload_logs')
export class MediaUploadLog extends BaseEntity {
  @Column({ name: 'client_id' })
  @Index()
  clientId: string;

  @Column({ name: 'ad_account_id' })
  adAccountId: string;

  @Column({ name: 'media_name' })
  mediaName: string;

  @Column({ name: 'original_file_name' })
  originalFileName: string;

  @Column({ name: 'mime_type' })
  mimeType: string;

  @Column({ type: 'enum', enum: MediaUploadStatus, default: MediaUploadStatus.PROCESSING })
  status: MediaUploadStatus;

  @Column({ name: 'drive_file_id' })
  driveFileId: string;

  @Column({ name: 'drive_url' })
  driveUrl: string;

  @Column({ name: 'meta_asset_id', nullable: true, default: null })
  metaAssetId: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true, default: null })
  errorMessage: string | null;

  @Column({ name: 'attempt_count', default: 0 })
  attemptCount: number;
}
