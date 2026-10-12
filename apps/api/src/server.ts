import 'dotenv/config';
import { createApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const app = createApp(config);

app.listen(config.PORT, () => {
  console.log(`servigo api listening on :${config.PORT}`);
});
