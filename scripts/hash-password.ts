/**
 * Prints an APP_PASSWORD_HASH line for .env.
 * Usage: npm run hash-password -- "<password>"   (or without argument: random password)
 */
import { hashPassword, randomToken } from "../src/server/crypto";

const given = process.argv[2];
const password = given ?? randomToken(18);
if (given && given.length < 12) {
  console.error("Please use at least 12 characters.");
  process.exit(1);
}
if (!given) console.log(`Generated password (store it in your password manager): ${password}`);
console.log(`APP_PASSWORD_HASH=${hashPassword(password)}`);
console.log(`INBOX_WEBHOOK_SECRET=${randomToken(32)}`);
