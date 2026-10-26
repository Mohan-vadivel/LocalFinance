"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const env_1 = require("./env");
(0, env_1.loadEnv)();
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule, { bodyParser: true });
    const origins = (process.env.CORS_ORIGIN ?? '*').split(',').map((s) => s.trim());
    // Accept /api/... as well as /..., so a proxy that keeps the /api part still reaches the routes
    const base = (process.env.API_BASE_PATH ?? '/api').replace(/\/+$/, '');
    if (base) {
        app.use((req, _res, next) => {
            if (req.url === base || req.url.startsWith(base + '/') || req.url.startsWith(base + '?'))
                req.url = req.url.slice(base.length) || '/';
            if (req.url.startsWith('?'))
                req.url = '/' + req.url;
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
//# sourceMappingURL=main.js.map