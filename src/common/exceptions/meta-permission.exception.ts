import { ForbiddenException } from '@nestjs/common';

export class MetaPermissionException extends ForbiddenException {
  constructor(identifier: string, metaMessage?: string) {
    super(
      `Missing Meta Ads permission for: ${identifier}. ` +
        (metaMessage ?? 'Grant ads_read or ads_management to the access token.'),
    );
  }
}
