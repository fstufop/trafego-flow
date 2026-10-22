import { IsNotEmpty, IsString } from 'class-validator';

export class CompleteUploadSessionDto {
  @IsString()
  @IsNotEmpty()
  adAccountId: string;

  @IsString()
  @IsNotEmpty()
  clientId: string;

  @IsString()
  @IsNotEmpty()
  mediaName: string;

  @IsString()
  @IsNotEmpty()
  originalFileName: string;

  @IsString()
  @IsNotEmpty()
  mimeType: string;

  @IsString()
  @IsNotEmpty()
  driveFileId: string;

  @IsString()
  @IsNotEmpty()
  driveUrl: string;
}
