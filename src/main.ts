import { NestFactory, Reflector } from '@nestjs/core';
import {
  ClassSerializerInterceptor,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import basicAuth from 'express-basic-auth';
import { AppModule } from './app.module.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.setGlobalPrefix('api/v1', {
    exclude: [{ path: 'webhook/(.*)', method: RequestMethod.ALL }],
  });
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  app.enableCors();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('TrafegoFlow API')
    .setDescription(
      'Plataforma de automação de respostas para gestores de tráfego',
    )
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-api-key' }, 'x-api-key')
    .addBearerAuth()
    .build();

  if (process.env.SWAGGER_USER && process.env.SWAGGER_PASSWORD) {
    app.use(
      ['/docs', '/docs-json'],
      basicAuth({
        users: { [process.env.SWAGGER_USER]: process.env.SWAGGER_PASSWORD },
        challenge: true,
      }),
    );
  }

  SwaggerModule.setup(
    'docs',
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}

void bootstrap();
