import { createApp, pickProvider } from './app.js';

const port = Number(process.env.PORT) || 3001;
const provider = pickProvider();
createApp({ provider }).listen(port, () => {
  console.log(`Benefits assistant API on http://localhost:${port} (provider: ${provider.name}/${provider.model})`);
});
