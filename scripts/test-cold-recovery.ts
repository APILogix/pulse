import { redis, connectRedis } from "../src/config/redis.js";
import { performance } from "node:perf_hooks";

const RAW_API_KEY = "pv_live_9039548f506985f832b42f16.fccedcad3f2440f86bd0e686464126e43acf28b606a2acda7fc2eb5e09011c04";
const ENDPOINT = "http://localhost:5000/v1/init";
const PROJECT_ID = "3606c81a-16bb-426b-a113-03fb17f80472";

async function run() {
  await connectRedis();
  const key = `remote-config:${PROJECT_ID}`;
  
  console.log("1. Deleting Redis key:", key);
  await redis.del(key);
  const ttlBefore = await redis.ttl(key);
  console.log("Key TTL after delete:", ttlBefore, "(Expected: -2 meaning key does not exist)");

  console.log("2. Calling /v1/init on cold cache (DB fallback)...");
  const t0 = performance.now();
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": RAW_API_KEY },
    body: JSON.stringify({}),
  });
  const coldDur = performance.now() - t0;
  console.log(`Cold /v1/init status: ${res.status}, duration: ${coldDur.toFixed(2)}ms`);

  console.log("3. Checking repopulated Redis key and TTL...");
  const ttlAfter = await redis.ttl(key);
  console.log(`Repopulated Redis TTL: ${ttlAfter} (Expected: -1 for persistent cache)`);

  console.log("4. Calling /v1/init on repopulated warm cache...");
  const t1 = performance.now();
  const resWarm = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": RAW_API_KEY },
    body: JSON.stringify({}),
  });
  const warmDur = performance.now() - t1;
  console.log(`Warm /v1/init status: ${resWarm.status}, duration: ${warmDur.toFixed(2)}ms`);

  if (ttlAfter === -1 && res.status === 200 && resWarm.status === 200) {
    console.log("\n=== COLD CACHE MISS & RECOVERY VERIFICATION PASSED! ===");
  } else {
    console.error("\n=== COLD CACHE MISS & RECOVERY VERIFICATION FAILED ===");
    process.exit(1);
  }

  await redis.quit();
}

run().catch(console.error);
