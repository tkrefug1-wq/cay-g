import 'dotenv/config';
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
const url = new URL(process.env.DATABASE_URL);
if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Local DB requires loopback host');
const pg = new EmbeddedPostgres({ databaseDir: '.local-db', user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), port: Number(url.port), persistent: true, authMethod: 'scram-sha-256', initdbFlags: ['--encoding=UTF8', '--locale=C'], postgresFlags: ['-c', 'listen_addresses=127.0.0.1'], onLog: () => {}, onError: console.error });
if (!existsSync('.local-db/PG_VERSION')) await pg.initialise();
await pg.start();
const client = pg.getPgClient();
await client.connect();
for (const name of [url.pathname.slice(1), ...(process.env.TEST_DATABASE_URL ? [new URL(process.env.TEST_DATABASE_URL).pathname.slice(1)] : [])]) {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error('Invalid database name');
  const result = await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [name]);
  if (!result.rows.length) await client.query(`CREATE DATABASE "${name}" WITH TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
}
await client.end();
console.log(`PostgreSQL ready on 127.0.0.1:${url.port}`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await pg.stop(); process.exit(0); });
setInterval(() => {}, 60_000);
