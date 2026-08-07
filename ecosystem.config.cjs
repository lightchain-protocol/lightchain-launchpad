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
      name: "lcai-indexer",
      cwd: "./apps/indexer",
      script: "node_modules/ponder/dist/esm/bin/ponder.js",
      // --disable-ui: the terminal UI redraws on a timer and would flood pm2's
      // log file. --hostname: keep Ponder's own server off the public interface.
      args: "start --hostname 127.0.0.1 --disable-ui --log-format json",
      env: { NODE_ENV: "production" },
      max_restarts: 10,
      restart_delay: 5000,
    },
    {
      name: "lcai-api",
      cwd: "./apps/api",
      script: "dist/main.js",
      env: { NODE_ENV: "production" },
      max_restarts: 10,
      restart_delay: 5000,
    },
  ],
};
