import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class CreateWhatsAppGroupDto {
  @IsUUID()
  clientId: string;

  @IsString()
  @Matches(/^\d+(-\d+)?@g\.us$/, { message: 'groupJid deve ter formato numérico@g.us (ex: 120363000000@g.us ou 553199999999-1499800546@g.us)' })
  groupJid: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;
}
