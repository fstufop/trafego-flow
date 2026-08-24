import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export enum MediaIntention {
  PRD = 'PRD',
  CAP = 'CAP',
}

export class UploadMediaDto {
  @IsString()
  @IsNotEmpty()
  adAccountId: string;

  @IsString()
  @IsNotEmpty()
  clientId: string;

  @IsEnum(MediaIntention)
  intention: MediaIntention;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  productName: string;
}
