import { defineCliConfig } from "sanity/cli";

import { dataset, projectId } from "./src/sanity/env";

export default defineCliConfig({
  api: { projectId, dataset },
  // The studio is served by Next.js at /studio.
  studioHost: undefined,
  autoUpdates: true,
});
