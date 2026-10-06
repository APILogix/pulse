import { redis, connectRedis } from "../src/config/redis.js";

async function main() {
  await connectRedis();
  const key = "remote-config:3606c81a-16bb-426b-a113-03fb17f80472";
  const ttl = await redis.ttl(key);
  console.log("=== REDIS TTL CHECK ===");
  console.log(`Key: ${key}`);
  console.log(`TTL: ${ttl} (${ttl === -1 ? "PERSISTENT / NO EXPIRATION - PASSED!" : "HAS EXPIRATION - FAILED!"})`);

  const raw = await redis.get(key);
  if (raw) {
    const doc = JSON.parse(raw);
    console.log("Cached Document Structure:");
    console.log({
      version: doc.version,
      projectId: doc.projectId,
      organizationId: doc.organizationId,
      environmentId: doc.environmentId,
      environment: doc.environment,
      release: doc.release,
      etag: doc.etag,
      hasConfig: !!doc.config,
      sampling: Object.keys(doc.config.sampling || {}),
      features: Object.keys(doc.config.features || {}),
    });
  } else {
    console.log("Key not found in Redis!");
  }

  await redis.quit();
}

main().catch(console.error);
