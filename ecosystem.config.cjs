// pm2 process definitions for the devnet server.
//   pm2 start ecosystem.config.cjs && pm2 save
//
// Each app loads its own env file from its cwd (Ponder reads apps/indexer/.env,
// the API's config.ts does `import "dotenv/config"` against apps/api/.env), so
// nothing is injected here.
//
// ponytail: the ponder bin is a /bin/sh wrapper, so pm2 is pointed at the real
// JS entry instead — otherwise pm2 supervises the shell, not the indexer, and
// restarts/signals go to the wrong process.
module.exports = {
  apps: [
    {
      name: "lcai-launchpad-indexer",
      cwd: "./apps/indexer",
      script: "node_modules/ponder/dist/esm/bin/ponder.js",
      // `ponder start` accepts only --schema/--port/--hostname; --disable-ui and
      // --log-format are `ponder dev` flags and make start exit immediately.
      //
      // --schema is passed explicitly, NOT left to DATABASE_SCHEMA in
      // apps/indexer/.env: Ponder resolves the schema before dotenv loads that
      // file, so it only works as a real process env var (which is how the
      // Dockerfile does it). Without the flag, start dies with
      // "Database schema required" and pm2 restart-loops.
      //
      // --hostname keeps Ponder's own server off the public interface.
      args: "start --schema public --hostname 127.0.0.1",
      env: { NODE_ENV: "production" },
      max_restarts: 10,
      restart_delay: 5000,
    },
    {
      name: "lcai-launchpad-api",
      cwd: "./apps/api",
      script: "dist/main.js",
      env: { NODE_ENV: "production" },
      max_restarts: 10,
      restart_delay: 5000,
    },
  ],
};
