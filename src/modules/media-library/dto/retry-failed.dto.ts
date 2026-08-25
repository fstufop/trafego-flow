import { IsNotEmpty, IsString } from 'class-validator';

export class RetryFailedDto {
  @IsString()
  @IsNotEmpty()
  clientId: string;
}
