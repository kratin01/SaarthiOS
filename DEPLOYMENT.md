# Deploying SaarthiOS

Plain English, start to finish. AWS for the API, Cloudflare in front, two repositories.

This file belongs in the **SaarthiOS** (API) repository.

---

## The shape of it

```
                    ┌────────────────┐
   your domain ────►│   Cloudflare   │  DNS, HTTPS, caching, DDoS
                    └───────┬────────┘
                            │
             ┌──────────────┴───────────────┐
             ▼                              ▼
   saarthios.space                    api.saarthios.space
   ┌──────────────────┐            ┌──────────────────┐
   │ Cloudflare Pages │            │  AWS EC2         │
   │ static files     │            │  nginx → Node    │
   │ SaarthiOS_Web    │            │  SaarthiOS       │
   └──────────────────┘            └────────┬─────────┘
                                            ▼
                                   ┌──────────────────┐
                                   │  MongoDB Atlas   │
                                   └──────────────────┘
```

Three things to do, in this order: deploy the **API**, deploy the **web app**, then point them at
each other.

---

## Step 1 — The two repositories ✅ done

```
SaarthiOS/
├── SaarthiOS/       → github.com/kratin01/SaarthiOS       (this file lives here)
└── SaarthiOS_Web/   → github.com/kratin01/SaarthiOS_Web
```

Both are pushed and on `main`. Each folder is named after the repository it *is*, so a fresh clone
of both gives the same layout on any machine.

Day to day:

```powershell
cd C:\Users\kaggarwal\Desktop\SaarthiOS\SaarthiOS       # the API
cd C:\Users\kaggarwal\Desktop\SaarthiOS\SaarthiOS_Web   # the web app

git add .
git commit -m "what changed"
git push
```

Make both **private** unless you want strangers reading them.

> **The cost of two repositories.** A change touching both sides — a new API route and the screen
> that calls it — becomes two commits, two reviews and two deploys that must land in the right
> order. One repository avoids that entirely. Splitting is still reasonable for separate pipelines
> and access control, and nothing here stops you merging them back later; just go in knowing.

---

## Step 2 — Generate production secrets

Fresh values, not the ones from your laptop.

```powershell
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('base64'))"
```

Run each separately and keep both.

> `ENCRYPTION_KEY` scrambles the AI keys people save in Settings. Leave it blank and it quietly
> borrows `JWT_SECRET` — fine until the day you rotate `JWT_SECRET`, when every saved AI key becomes
> undecryptable. Set both now.

Then **rotate your Atlas database password**: Atlas → Database Access → Edit user → Edit Password.

---

## Step 3 — The API on EC2

### 3.1 Launch the machine

1. EC2 → **Launch instance**
2. Name `saarthios-api`, image **Ubuntu Server 24.04 LTS**, type **t3.small**

   > `t2.micro` and its 1 GB of RAM runs the API fine. You could not build the *web* app on it, but
   > Cloudflare Pages does that for you, so free tier is viable here.
3. Key pair: create one, download the `.pem`, keep it safe — it is the only way in.
4. Network settings → allow **SSH (22) from My IP** and **HTTP (80) from Anywhere** for now.
   Port 443 and the Cloudflare lock-down come in 3.6.
5. Launch, then **Elastic IP** → Allocate → Associate, or the address changes on every reboot.

### 3.2 Install

```powershell
ssh -i "C:\path\to\key.pem" ubuntu@YOUR-ELASTIC-IP
```

```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs nginx git
sudo npm install -g pm2
node -v      # expect v22.x
```

### 3.3 Get the code

```bash
cd ~
git clone https://github.com/kratin01/SaarthiOS.git
cd SaarthiOS
npm install --omit=dev
```

### 3.4 Configure

```bash
nano ~/SaarthiOS/.env
```

```ini
NODE_ENV=production
PORT=5000

MONGODB_URI=mongodb+srv://...
JWT_SECRET=paste-generated-secret
ENCRYPTION_KEY=paste-other-generated-secret

# Where the web app is served from. No trailing slash.
CLIENT_ORIGIN=https://saarthios.space

# Cloudflare sits in front of nginx, so two hops. See 3.6.
TRUST_PROXY=2

GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com

LLM_PROVIDER=gemini
LLM_API_KEY=your-key
LLM_MODEL=
```

Start it, and make it survive reboots:

```bash
cd ~/SaarthiOS
pm2 start src/index.js --name saarthios-api
pm2 save
pm2 startup          # prints a command — copy it, run it
pm2 logs saarthios-api --lines 30
```

You want `MongoDB connected` and `SaarthiOS API on http://localhost:5000`.

### 3.5 nginx

```bash
sudo nano /etc/nginx/sites-available/saarthios
```

```nginx
server {
    listen 80;
    server_name api.saarthios.space;

    # Bank statements and bills can be large. Nginx defaults to 1 MB and would
    # reject them before the app ever sees the upload.
    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # AI replies can take up to 45 seconds. The default 60 is too close.
        proxy_read_timeout 120s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/saarthios /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t                  # must say "test is successful"
sudo systemctl restart nginx
```

### 3.6 Two things Cloudflare changes

**Client IPs gain a hop.** Requests now go visitor → Cloudflare → nginx → Node. Express has to be
told how many proxies to believe when working out who is calling, because that is what the rate
limiter counts against. Hence `TRUST_PROXY=2` above.

Getting it wrong fails silently, in the worst direction: with `TRUST_PROXY=1` every visitor looks
like the same Cloudflare edge server, so one person hitting a rate limit locks out everyone sharing
that edge. In production the API prints what it resolved:

```
[12:00:00] INFO Trusting 2 proxy hop(s) for client IPs
```

**Your origin is still reachable directly.** Cloudflare only protects traffic that goes *through*
it. Anyone who learns your Elastic IP can skip it — and since the app trusts forwarded headers,
they could forge a client IP and dodge rate limits entirely.

Fix it by accepting web traffic only from Cloudflare. In the EC2 **security group**, delete the
`0.0.0.0/0` rule on port 80 and add Cloudflare's published ranges instead:

```
https://www.cloudflare.com/ips-v4
https://www.cloudflare.com/ips-v6
```

Add each as an inbound rule for ports 80 and 443. Keep SSH restricted to your own IP.

> Skip this and everything still works — you have just left the front door open next to the guarded
> one. Do it before you share the URL.

---

## Step 4 — The web app

Unlike the API, this is not a running program. `npm run build` turns it into a folder of plain
files, and a host serves them. Nothing else happens at runtime.

### 4.1 Build it once on your own machine

Worth doing before you touch the server: a build that fails on EC2 gives you an SSH session and a
stack trace to squint at; the same failure locally gives you your own machine to poke at.

```powershell
git clone https://github.com/kratin01/SaarthiOS_Web.git
cd SaarthiOS_Web
npm ci
```

> `npm ci` rather than `npm install` — it installs exactly what `package-lock.json` pins, which is
> what the server does too. If `npm ci` fails but `npm install` works, your lockfile is out of step
> and the server will fail the same way.

The one setting is the API address, and it is baked in at **build time**. Create `.env.production`
in the repo root:

```ini
VITE_API_URL=https://api.saarthios.space
```

No `/api` on the end and no trailing slash — the code appends `/api` itself.

> **Nothing in a `VITE_` variable is secret.** Vite writes these into the JavaScript that ships to
> the browser, so anyone can read them. A public API URL is fine there. An API key never is.

Then:

```powershell
npm run build      # type-checks, then writes dist/
npm run preview    # serves dist/ on http://localhost:4173 to check it
```

`dist/` should contain `index.html`, an `assets/` folder, and `_redirects`. If `_redirects` is
missing, routing will break once deployed — see 4.4.

### 4.2 Build it on the server and let nginx serve it

This is the path you are taking: one EC2 box serves both the web app and the API.

```bash
cd ~
git clone https://github.com/kratin01/SaarthiOS_Web.git
cd SaarthiOS_Web
npm ci
```

Set the API address before building — the value is compiled into the JavaScript:

```bash
echo "VITE_API_URL=https://api.saarthios.space" > .env.production
npm run build
```

That writes `dist/`. Let nginx read it:

```bash
sudo chmod o+x /home/ubuntu                 # nginx must be able to traverse into your home
```

Then add a second server block (see 4.3), point DNS at the box, and you are done.

To ship a change later:

```bash
cd ~/SaarthiOS_Web
git pull
npm ci
npm run build          # nginx picks up the new files immediately, no restart
```

> **Build on a machine with at least 2 GB of RAM.** On a `t2.micro` (1 GB) `npm run build` is
> usually killed part-way through with no clear error. Either use `t3.small`, add swap, or build on
> your laptop and copy `dist/` up with `scp`.

### 4.3 The nginx block for the web app

```bash
sudo nano /etc/nginx/sites-available/saarthios-web
```

```nginx
server {
    listen 80;
    server_name saarthios.space www.saarthios.space;

    root /home/ubuntu/SaarthiOS_Web/dist;
    index index.html;

    # React Router owns the URLs. Without this, refreshing on /chat asks nginx
    # for a file that does not exist and gets a 404.
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Hashed filenames never change contents, so they can be cached hard.
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/saarthios-web /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

You now have two server blocks: this one on `saarthios.space`, and the API one on
`api.saarthios.space` from step 3.5. nginx picks between them by hostname.

> **403 Forbidden** means the `chmod o+x /home/ubuntu` line was skipped — nginx cannot get into the
> folder to read `dist/`.

### 4.4 Or use Cloudflare Pages instead

If you would rather not build on the server, Pages rebuilds from GitHub on every push and serves
from Cloudflare's CDN. You would then skip 4.2 and 4.3 entirely.

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. Pick **SaarthiOS_Web**
3. Build settings:

   | Field | Value |
   | --- | --- |
   | Framework preset | Vite |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | Root directory | *(blank — the repo root is the app)* |

4. Environment variables → add `VITE_API_URL` = `https://api.saarthios.space`
5. **Save and Deploy.**

Because `VITE_API_URL` is read at build time, changing it later means triggering a **rebuild** —
restarting or clearing cache will not pick it up.

### 4.5 Why `_redirects` matters

The repository contains `public/_redirects`:

```
/*    /index.html   200
```

That is the Cloudflare Pages equivalent of the `try_files` line above: hand unknown paths back to
the app instead of 404ing. Vite copies everything in `public/` into `dist/` untouched, so it ends up
in the build automatically. On nginx it is ignored and harmless.

---

## Step 5 — DNS and certificates

Cloudflare → **DNS**:

| Type | Name | Content | Proxy |
| --- | --- | --- | --- |
| A | `@` | your Elastic IP | **Proxied** (orange cloud) |
| A | `www` | your Elastic IP | Proxied |
| A | `api` | your Elastic IP | Proxied |

All three point at the same box — nginx tells them apart by hostname. (If you use Cloudflare Pages
for the web app instead, make `@` and `www` a CNAME to your Pages domain and leave only `api` on the
Elastic IP.)

Then **SSL/TLS → Overview**:

- **Full (strict)** — what you want. Cloudflare talks HTTPS to EC2 and verifies the certificate.
  Create a free **Origin Certificate** (SSL/TLS → Origin Server → Create Certificate), save the cert
  and key on the box, and add `listen 443 ssl;` with those files to the nginx block.
- **Flexible** — Cloudflare talks plain HTTP to your origin. Easier, and genuinely worse: the last
  hop is unencrypted. Not for an app holding personal financial and health data.

> Do **not** run certbot here. Cloudflare already terminates HTTPS, and Let's Encrypt's HTTP
> challenge fails once traffic is proxied. The Origin Certificate replaces it.

---

## Step 6 — Introduce everything

1. **Atlas → Network Access** — add your Elastic IP as `YOUR-IP/32`. It is fixed, so lock it down
   properly instead of opening it to the world.
2. **Google Cloud Console** → Credentials → your OAuth client → **Authorised JavaScript origins** →
   add `https://saarthios.space`. Exact, no trailing slash.
3. **`.env` on EC2** — confirm `CLIENT_ORIGIN=https://saarthios.space`, then
   `pm2 restart saarthios-api`.

---

## Step 7 — Check it

- [ ] Register a new account
- [ ] Sign in with Google
- [ ] Send a chat message and see it save
- [ ] Refresh while on `/chat` — reloads, does not 404
- [ ] Upload a bill
- [ ] Check share prices on Investments
- [ ] Toggle dark mode
- [ ] `https://api.saarthios.space/api/health` returns `{"status":"ok"}`

---

## Deploying updates

**Web** — `git push` to `SaarthiOS_Web`. Pages rebuilds on its own.

**API** — SSH in:

```bash
cd ~/SaarthiOS
git pull
npm install --omit=dev
pm2 restart saarthios-api
```

> When a change spans both repositories, deploy the **API first**. The web app can call an endpoint
> that already exists; it cannot call one that does not.

---

## Telling users when something is broken

Four variables put a message in front of people **without a redeploy**. Edit `.env`, run
`pm2 restart saarthios-api`, and it shows within a minute:

```ini
NOTICE_GLOBAL=Scheduled maintenance tonight, 11pm to midnight IST.
NOTICE_CHAT=Our AI credits ran out. Chat is back on Monday.
NOTICE_PRICES=Switching price providers, back shortly.
NOTICE_IMPORT=Statement import is paused while we fix PDF reading.
```

Blank them to clear. You do not need these for the obvious failures — the app already detects and
explains a database it cannot reach, an AI provider that is failing, and a dead price feed. Anything
you write here overrides that wording.

---

## All the environment variables

### API (`SaarthiOS`)

| Name | What to put | Why |
| --- | --- | --- |
| `MONGODB_URI` | Atlas connection string | **Required** |
| `JWT_SECRET` | Generated, 16+ chars | **Required** |
| `NODE_ENV` | `production` | Tighter logging |
| `ENCRYPTION_KEY` | Generated | Encrypts saved AI keys |
| `CLIENT_ORIGIN` | `https://saarthios.space` | Without it the browser blocks every request |
| `TRUST_PROXY` | `2` behind Cloudflare | Real client IPs for rate limiting |
| `GOOGLE_CLIENT_ID` | Your OAuth client ID | Blank hides the Google button |
| `LLM_PROVIDER` / `LLM_API_KEY` | e.g. `gemini` + key | Default AI |
| `MAX_CUSTOM_AGENTS` | unset → `2` | Agents each user may build |
| `NOTICE_*` | blank | Outage messages, above |
| `PORT` | `5000` | Port nginx forwards to |

### Web (`SaarthiOS_Web`)

| Name | What to put |
| --- | --- |
| `VITE_API_URL` | `https://api.saarthios.space` |

### Needs no configuration

Share prices use Yahoo Finance's public endpoints — no key, nothing in `.env`. They need only
outbound HTTPS from EC2, which the default security group already allows: it restricts what comes
in, not what goes out.

---

## Before you call it live

- [ ] `JWT_SECRET` and `ENCRYPTION_KEY` freshly generated
- [ ] Atlas password rotated, access limited to your Elastic IP
- [ ] Neither repository contains `.env` (`git log --all -- .env` prints nothing)
- [ ] Both repositories private
- [ ] Security group accepts web traffic **only from Cloudflare ranges**
- [ ] SSL/TLS mode is Full (strict), not Flexible
- [ ] `TRUST_PROXY=2`, and the startup log agrees
- [ ] Production domain added to Google's authorised origins
- [ ] Registered a fresh account on the live site, end to end

---

## When something breaks

| What you see | What it means | Fix |
| --- | --- | --- |
| Everything fails, console mentions CORS | API does not recognise the web app | `CLIENT_ORIGIN` must match exactly, no trailing slash |
| Requests 404 with `/api/api/` in the URL | `/api` typed twice | Remove it from `VITE_API_URL`, redeploy |
| 404 when refreshing on `/chat` | Missing SPA rewrite | `public/_redirects` must be in the build |
| One user's rate limit blocks everyone | Wrong proxy count | `TRUST_PROXY=2` behind Cloudflare |
| Cloudflare 521 / 522 | Cannot reach the origin | Security group must allow Cloudflare ranges; check nginx is running |
| Cloudflare 525 | TLS handshake to origin failed | Full (strict) needs an Origin Certificate on nginx |
| Backend hangs, never says "MongoDB connected" | Atlas is blocking EC2 | Add the Elastic IP under Network Access |
| Uploads fail around 1 MB | nginx default | `client_max_body_size 10M` |
| 502 Bad Gateway | Node is not running | `pm2 logs saarthios-api` |
| `Cannot find module @rollup/rollup-linux-x64-gnu` | Lockfile was generated on Windows and omits the Linux binary | Already fixed — `git pull` then `npm ci`. If it returns, run `npm install` on Linux once and commit the lockfile |
| `EBADENGINE ... unpdf requires node >=22` | Node 20 installed | Install Node 22: `curl -fsSL https://deb.nodesource.com/setup_22.x \| sudo -E bash - && sudo apt install -y nodejs` |
| `npm run build` dies with no error | Out of RAM on a 1 GB box | Use `t3.small`, add swap, or build locally and `scp` the `dist/` folder up |
| 403 Forbidden on the web app | nginx cannot read your home folder | `sudo chmod o+x /home/ubuntu` |
| Everyone logged out after a deploy | `JWT_SECRET` changed | Expected; sign in again |
| Saved AI keys stopped working | `ENCRYPTION_KEY` changed | Re-enter them in Settings |

---

## One thing worth knowing

You do not need to redeploy to change AI providers or keys. Sign in on the live site, go to
**Settings → AI provider**, and swap the key or model there. It is stored encrypted in the database.
The `LLM_*` values in `.env` are only the fallback for users who have not set their own.
