import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { MediaIntention } from './upload-media.dto.js';

export class CreateUploadSessionDto {
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

  @IsString()
  @IsNotEmpty()
  originalFileName: string;

  @IsString()
  @IsNotEmpty()
  mimeType: string;
}
