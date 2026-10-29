import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
  ) {}

  async send(input: SendMailInput): Promise<void> {
    const apiKey = this.config.get<string>('mailgun.apiKey');
    const domain = this.config.get<string>('mailgun.domain');
    const from = this.config.get<string>('mailgun.from');

    const body = new URLSearchParams({
      from: from!,
      to: input.to,
      subject: input.subject,
      html: input.html,
    });

    await firstValueFrom(
      this.httpService.post(
        `https://api.mailgun.net/v3/${domain}/messages`,
        body,
        {
          auth: { username: 'api', password: apiKey! },
        },
      ),
    ).catch((err: Error) => {
      this.logger.error(
        `Mailgun error sending mail to ${input.to}: ${err.message}`,
      );
      throw err;
    });
  }
}
