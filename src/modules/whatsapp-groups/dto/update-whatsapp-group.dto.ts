import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateWhatsAppGroupDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
