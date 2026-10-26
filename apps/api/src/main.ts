import 'reflect-metadata';
import { loadEnv } from './env';
loadEnv();
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: true });
  const origins = (process.env.CORS_ORIGIN ?? '*').split(',').map((s) => s.trim());
  // Accept /api/... as well as /..., so a proxy that keeps the /api part still reaches the routes
  const base = (process.env.API_BASE_PATH ?? '/api').replace(/\/+$/, '');
  if (base) {
    app.use((req: { url: string }, _res: unknown, next: () => void) => {
      if (req.url === base || req.url.startsWith(base + '/') || req.url.startsWith(base + '?')) req.url = req.url.slice(base.length) || '/';
      if (req.url.startsWith('?')) req.url = '/' + req.url;
      next();
    });
  }
  app.enableCors({ origin: origins.includes('*') ? true : origins, credentials: true });
  app.useBodyParser('json', { limit: '5mb' });
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`SmartFinora API listening on :${port}`);
}
bootstrap();
