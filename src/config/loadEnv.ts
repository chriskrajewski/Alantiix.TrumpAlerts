import { config } from "dotenv";

const alreadyLoaded = Boolean((globalThis as Record<string, unknown>).__alantiixEnvLoaded);

if (!alreadyLoaded) {
  if (process.env.NODE_ENV !== "production" || process.env.LOAD_LOCAL_ENV === "true") {
    config();
  }
  (globalThis as Record<string, unknown>).__alantiixEnvLoaded = true;
}
