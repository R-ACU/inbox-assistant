/**
 * Environment for the n8n child process. Built from an allowlist, not by copying
 * process.env: the assistant's secrets (API key, webhook secret, password hash, the
 * local demo password, the intake token) never reach n8n. n8n gets its own
 * credentials through `npm run n8n -- setup`, stored encrypted in its database.
 */

/** System variables a Node child process needs to start on Windows, Linux and macOS. */
const SYSTEM_VARS = [
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "windir",
  "ComSpec",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "ProgramData",
  "ProgramFiles",
  "LANG",
  "TZ",
  "NODE_EXTRA_CA_CERTS",
  "npm_config_cache",
];

/** n8n settings that may come from .env. N8N_INGRESS_TOKEN is a credential, not a setting. */
const N8N_SETTING = /^N8N_(?!INGRESS_TOKEN$)[A-Z0-9_]+$/;

export function buildN8nEnv(source: NodeJS.ProcessEnv, opts: { userFolder: string; port: number }): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of SYSTEM_VARS) {
    const value = source[name];
    if (value !== undefined) env[name] = value;
  }
  for (const [name, value] of Object.entries(source)) {
    if (N8N_SETTING.test(name) && value !== undefined) env[name] = value;
  }
  const url = `http://127.0.0.1:${opts.port}`;
  return {
    ...env,
    N8N_USER_FOLDER: opts.userFolder,
    N8N_PORT: String(opts.port),
    N8N_LISTEN_ADDRESS: "127.0.0.1",
    N8N_HOST: "127.0.0.1",
    N8N_PROTOCOL: "http",
    WEBHOOK_URL: `${url}/`,
    N8N_DIAGNOSTICS_ENABLED: "false",
    N8N_PERSONALIZATION_ENABLED: "false",
    N8N_VERSION_NOTIFICATIONS_ENABLED: "false",
    N8N_TEMPLATES_ENABLED: "false",
    N8N_SECURE_COOKIE: "false",
    // The workflow needs no environment access; keep the n8n default that blocks it.
    N8N_BLOCK_ENV_ACCESS_IN_NODE: "true",
    // Execution data contains whole mails. Successful runs are not stored at all (workflow
    // setting); failed runs are pruned after 24 hours.
    EXECUTIONS_DATA_PRUNE: "true",
    EXECUTIONS_DATA_MAX_AGE: "24",
  };
}
