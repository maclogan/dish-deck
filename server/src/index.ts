import { buildApp } from "./app.js";
import { ConfigError, loadConfig, loadEnvFile } from "./config.js";

const envFile = loadEnvFile();

let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    if (!envFile) console.error("No .env file found. Copy example.env to .env and fill it in, or set the variables in your environment.");
    process.exit(1);
  }
  throw err;
}

const app = buildApp(config);

app
  .listen({ port: config.port, host: config.host })
  .then(() => {
    app.log.info(
      `Dish Deck listening on :${config.port} | Mealie ${config.mealieUrl} | AI ${config.anthropicApiKey ? "on" : "off"} | ` +
        `passcode ${config.appPasscode ? "on" : "OFF"}${envFile ? ` | env file ${envFile}` : ""}`,
    );
    if (!config.appPasscode) {
      app.log.warn("APP_PASSCODE is not set: anyone who can reach this app can change your Mealie data.");
    }
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    app.close().finally(() => process.exit(0));
  });
}
