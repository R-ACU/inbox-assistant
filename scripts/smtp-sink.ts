/**
 * Local test SMTP server for the n8n flow. Accepts mail on 127.0.0.1:2525 and
 * writes each message to data/smtp-sink/ instead of delivering it anywhere.
 * Usage: npm run smtp-sink
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SMTPServer } from "smtp-server";

const dir = join(process.cwd(), "data", "smtp-sink");
mkdirSync(dir, { recursive: true });
const port = Number(process.env.SMTP_SINK_PORT ?? 2525);

const server = new SMTPServer({
  authOptional: true,
  disabledCommands: ["STARTTLS"],
  size: 5 * 1024 * 1024,
  onData(stream, session, callback) {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => {
      const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.eml`);
      writeFileSync(file, Buffer.concat(chunks));
      console.log(`received mail for ${session.envelope.rcptTo.map((r) => r.address).join(", ")} -> ${file}`);
      callback();
    });
  },
});

server.listen(port, "127.0.0.1", () => console.log(`Test SMTP listening on 127.0.0.1:${port}, writing to ${dir}`));
