# Deploying the demo on Render

The repository includes [`render.yaml`](../render.yaml), a Render Blueprint that describes one free Node web
service. Render reads it, installs the dependencies, builds the app and starts it. You do not type any commands.

What the Blueprint does:

| Setting | Value |
| --- | --- |
| Build command | `npm ci --include=dev && npm run build` |
| Start command | `npm start` (runs `node dist/server/index.js`) |
| Node.js | 24.19.0 (`NODE_VERSION`) |
| Port | Render's `PORT` (10000), read by the server |
| Address | `HOST=0.0.0.0`, so Render can reach the server |
| Public hostname | Render's `RENDER_EXTERNAL_HOSTNAME`, accepted by the server's Host check |

Tests do not run on Render. Run them on your own machine before you push.

## Step by step

1. **Put the code on GitHub.** The repository must be on your GitHub account, with `render.yaml` at its root on
   the `main` branch.
2. **Create a Render account.** Go to [render.com](https://render.com) and sign up. Signing up with GitHub is the
   simplest option, because Render can then ask for access to your repositories.
3. **Start a Blueprint.** In the Render Dashboard, click **New > Blueprint**.
4. **Connect the repository.** If GitHub is not connected yet, Render sends you to GitHub to choose which
   repositories it may see; you can limit it to `supply-chain-command-center`. Back in Render, click **Connect**
   next to that repository.
5. **Review.** Give the Blueprint a name (any name), keep the branch `main` and leave *Blueprint Path* as
   `render.yaml`. Render lists one resource: the web service `supply-chain-command-center` on the Free plan.
6. **Deploy.** Click **Deploy Blueprint**. Open the service to watch the log. The first build takes a few
   minutes. It is done when the log shows
   `Supply Chain Command Center running at http://0.0.0.0:10000 (production)`.
7. **Get the link.** The service page shows its address at the top, for example
   `https://supply-chain-command-center.onrender.com`. Render may add a suffix if that name is taken. Open it to
   check the dashboard loads, then paste it after **Live demo:** in the README.

Every push to `main` redeploys the service automatically.

## Demo limits

- **One shared copy of the data.** Data lives in the server's memory, and every visitor sees the same copy. If
  someone imports a file, everyone sees the imported data until someone clicks **Restore sample data** on
  Data Import, or the server restarts.
- **The server sleeps.** A free service stops after 15 minutes without visits. The next visit wakes it, which
  takes about a minute, so the first page load is slow.
- **Every start resets the data.** Waking up, redeploying or restarting rebuilds the sample data with seed 42.
  Imported data is not kept.
- **The sample refreshes each day.** The first visit of a new day rebuilds the sample data for that day, so its
  dates stay current. Imported data stays as it is until the server restarts.
- **Dates follow the calendar.** "Today" is the server's current date, so the sample shipments move with real
  time. To freeze the dates, set `SCC_TODAY` (format `YYYY-MM-DD`) under *Environment* on the service.
- **Monthly hours.** Render gives each workspace 750 free instance hours per month, enough for one service
  that runs all month.

## If something goes wrong

- **The build stops at `tsc` or `vite`, "not found".** The build command must keep `--include=dev`.
  Otherwise npm skips TypeScript and Vite, because `NODE_ENV` is `production`.
- **The page shows "This server does not respond to that Host."** The server only answers on its own
  hostname. Render sets that hostname for you. If you add a custom domain, set `SCC_PUBLIC_HOST` to that exact
  domain (for example `scc.example.com`) under *Environment*. Only one public hostname is accepted at a time.
- **Upload limit.** Files up to 2 MB are accepted (`SCC_MAX_UPLOAD_BYTES`).

## Check the same commands on your machine

```bash
npm ci --include=dev
npm run build
```

Then start it the way Render does (in PowerShell, set each variable with `$env:NAME = "value"` first):

```bash
PORT=10000 HOST=0.0.0.0 NODE_ENV=production npm start
```

Open <http://localhost:10000>.
