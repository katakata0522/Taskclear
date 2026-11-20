const express = require('express');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

const BLOCKED_PREFIXES = [
  '/server.js',
  '/package.json',
  '/package-lock.json',
  '/metadata.json',
  '/node_modules',
  '/test',
];

app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');

  const reqPath = req.path.toLowerCase();
  if (
    BLOCKED_PREFIXES.some(
      (prefix) => reqPath === prefix || reqPath.startsWith(`${prefix}/`)
    )
  ) {
    return res.status(404).send('Not Found');
  }
  next();
});

app.use(
  express.static(__dirname, {
    dotfiles: 'ignore',
    etag: true,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

app.get('/', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
