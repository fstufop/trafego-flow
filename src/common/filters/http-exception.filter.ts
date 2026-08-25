import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let body: Record<string, unknown>;
    let logDetail: string;

    if (exception instanceof HttpException) {
      const raw = exception.getResponse();
      if (typeof raw === 'object' && raw !== null) {
        body = raw as Record<string, unknown>;
        const msg = (raw as any).message;
        // ValidationPipe sends message as string[]
        logDetail = Array.isArray(msg) ? msg.join(' | ') : String(msg ?? exception.message);
      } else {
        body = { statusCode: status, message: raw };
        logDetail = String(raw);
      }
    } else {
      body = { statusCode: status, message: 'Internal server error' };
      logDetail = exception instanceof Error ? exception.message : String(exception);
    }

    const prefix = `${req.method} ${req.originalUrl} ${status}`;

    if (status >= 500) {
      this.logger.error(
        `${prefix} — ${logDetail}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(`${prefix} — ${logDetail}`);
    }

    res.status(status).json(body);
  }
}
