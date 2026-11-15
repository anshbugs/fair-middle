import { randomBytes } from "node:crypto";

export const newId = (bytes = 9) => randomBytes(bytes).toString("base64url");
