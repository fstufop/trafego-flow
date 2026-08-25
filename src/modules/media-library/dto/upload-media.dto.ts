import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

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

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  startVersion?: number;
}
