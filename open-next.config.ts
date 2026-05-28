import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * OpenNext for Cloudflare. Default config is the right starting point —
 * builds the Next.js app into a Worker + static assets bundle that wrangler
 * deploys. Tweak only when something demands it (custom caching, KV/D1
 * incremental cache, queue-driven revalidation, etc).
 */
export default defineCloudflareConfig();
