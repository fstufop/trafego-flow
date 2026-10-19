import { HttpException, HttpStatus } from '@nestjs/common';

export class GraphApiRateLimitException extends HttpException {
  constructor(identifier: string) {
    super(
      `Instagram Graph API rate limit reached for: ${identifier}`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
