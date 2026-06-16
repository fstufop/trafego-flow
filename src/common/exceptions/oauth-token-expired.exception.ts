import { UnauthorizedException } from '@nestjs/common';

export class OAuthTokenExpiredException extends UnauthorizedException {
  constructor(identifier: string) {
    super(`OAuth token expired or invalid for: ${identifier}`);
  }
}
