import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

createApp().listen(port, host, () => {
  console.log(`kmd-community-api listening on http://${host}:${port}`);
});
