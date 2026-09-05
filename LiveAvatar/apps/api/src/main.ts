import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { loadEnv } from './modules/platform/infrastructure/env-loader';

/**
 * Boots the public NestJS listener (`:8080`, LLD §5.1). Env is validated
 * before the Nest container is created so a missing secret fails fast with
 * a clear message instead of a confusing DI error later.
 */
async function bootstrap(): Promise<void> {
  loadEnv();

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          // The conversation SPA's browser client opens both a WebSocket
          // and an HTTP "validate" preflight straight to LiveKit
          // (livekit-client, not routed through this API) — helmet's
          // default CSP has no `connect-src`, so it falls back to
          // `default-src 'self'` and silently blocks that connection,
          // which otherwise fails as an opaque "could not establish
          // signal connection" with no indication it's a CSP block.
          connectSrc: ["'self'", ...publicLiveKitConnectSrc()],
        },
      },
    }),
  );
  app.enableCors({
    origin: (process.env.ADMIN_ORIGIN ?? 'http://localhost:4200').split(','),
    credentials: false,
  });

  if ((process.env.NODE_ENV ?? 'development') !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('LiveAvatar Control Plane API')
      .setVersion('1')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = Number(process.env.PORT ?? 8080);
  await app.listen(port);
}

/**
 * The `ws://`/`wss://` origin the browser-side LiveKit client actually
 * connects to (`LIVEKIT_PUBLIC_URL`, falling back to `LIVEKIT_URL` when a
 * deployment's internal and public LiveKit addresses are the same, e.g. a
 * real `wss://` hostname reachable from both sides) — never the
 * container-internal `LIVEKIT_URL` alone, which in compose/k8s is a
 * cluster-only hostname (`ws://livekit:7880`) a browser can never resolve.
 * Returns both the `ws(s)` origin and its `http(s)` counterpart, since
 * livekit-client also makes a plain HTTP validate call to the same host.
 */
function publicLiveKitConnectSrc(): string[] {
  const raw = process.env.LIVEKIT_PUBLIC_URL ?? process.env.LIVEKIT_URL;
  if (!raw) {
    return [];
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return [];
  }
  const isSecure = parsed.protocol === 'wss:' || parsed.protocol === 'https:';
  const wsScheme = isSecure ? 'wss:' : 'ws:';
  const httpScheme = isSecure ? 'https:' : 'http:';
  return [`${wsScheme}//${parsed.host}`, `${httpScheme}//${parsed.host}`];
}

bootstrap().catch((err: unknown) => {
  console.error('Fatal error during bootstrap', err);
  process.exit(1);
});
