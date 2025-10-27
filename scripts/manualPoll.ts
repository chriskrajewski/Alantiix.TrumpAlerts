import "../src/config/loadEnv";
import { runPollingCycle } from "../src/services/polling";

async function main() {
  const result = await runPollingCycle();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
