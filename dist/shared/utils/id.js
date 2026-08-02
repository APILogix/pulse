import { nanoid } from "nanoid";
import { v7 as uuidv7 } from "uuid";
export function generateId() {
    return nanoid();
}
export function generateUUID() {
    return uuidv7();
}
//# sourceMappingURL=id.js.map