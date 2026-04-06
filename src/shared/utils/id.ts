import { nanoid } from "nanoid";
import { v7 as uuidv7 } from "uuid";

export function generateId(): string {
  return nanoid();
}

export function generateUUID(): string {
  return uuidv7();
}