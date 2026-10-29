import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MailService } from './mail.service.js';

@Module({
  imports: [HttpModule],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
