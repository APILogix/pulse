import Redis from "ioredis";
import { logger } from "./logger.js";
import { log } from "node:console";

// 👉 Hardcode for now (don’t over-engineer env yet)
const REDIS_URL = "redis://localhost:6379";

export const redis = new Redis(REDIS_URL, {
  lazyConnect: true, // we control when to connect
});

// 🔌 Connect function
export const connectRedis = async () => {
  try {
    await redis.connect();
   logger.info(" Connected to Redis");
  } catch (err) {
    logger.error({ err }, " Failed to connect to Redis");
    process.exit(1);
  }
};

// 🧪 Health check (PING)
export const checkRedis = async () => {
  try {
    const res = await redis.ping();
    console.log("📡 Redis ping:", res); // should be PONG
    return res === "PONG";
  } catch (err) {
    console.error("❌ Redis ping failed:", err);
    return false;
  }
};

// 🔌 Close connection
export const closeRedis = async () => {
  await redis.quit();
  console.log("🛑 Redis connection closed");
};