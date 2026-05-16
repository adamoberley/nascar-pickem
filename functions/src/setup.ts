import { setGlobalOptions } from "firebase-functions/v2/options";

setGlobalOptions({
  region: "us-central1",
  memory: "512MiB",
  timeoutSeconds: 120,
  maxInstances: 10,
});
