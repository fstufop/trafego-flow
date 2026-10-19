import { BadRequestException } from '@nestjs/common';

export class MessagingWindowExpiredException extends BadRequestException {
  constructor(identifier: string) {
    super(
      `Messaging window expired for: ${identifier} — Instagram only allows a reply within 24h of the user's last message (or 7 days for comments)`,
    );
  }
}
