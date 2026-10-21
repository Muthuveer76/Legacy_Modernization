import fs from 'node:fs';
import path from 'node:path';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config.js';
import { HttpError, errorHandler, notFound } from './middleware/errors.js';
import authRoutes from './routes/auth.js';
import jobRoutes from './routes/jobs.js';
import metaRoutes from './routes/meta.js';
import projectRoutes from './routes/projects.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'script-src': ["'self'"],
          'img-src': ["'self'", 'data:'],
          'connect-src': ["'self'"],
        },
      },
    }),
  );
  app.use(compression());
  if (!config.isTest) app.use(morgan(config.isProd ? 'combined' : 'dev'));
  app.use(express.json({ limit: '4mb' }));
  app.use(cookieParser());

  // Defence in depth on top of SameSite cookies: state-changing calls must be JSON,
  // which a cross-site form cannot send.
  app.use('/api', (req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !req.is('application/json')) {
      return next(new HttpError(415, 'Send API requests as application/json'));
    }
    return next();
  });

  app.use('/api', metaRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/projects', projectRoutes);
  app.use('/api/jobs', jobRoutes);
  app.use('/api', notFound);

  const indexHtml = path.join(config.clientDist, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use(
      express.static(config.clientDist, {
        index: false,
        setHeaders: (res, filePath) => {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        },
      }),
    );
    app.get(/^(?!\/api(\/|$)).*/, (req, res) => res.sendFile(indexHtml));
  }

  app.use(errorHandler);
  return app;
}
