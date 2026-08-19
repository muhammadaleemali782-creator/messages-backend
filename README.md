# Apna khud ka Mail Server

Ye 100% self-hosted hai — koi Gmail, SendGrid, ya kisi third-party email API ka use nahi hota.
Sending seedha recipient ke MX server ko hoti hai, receiving apka khud ka SMTP server karta hai.

## Isko chalane ke liye 3 real cheezein chahiye (code ke alawa)

Ye cheezein main is chat/sandbox se provide nahi kar sakta — ye aapko khud arrange karni padengi:

### 1. Ek VPS jispe outbound/inbound port 25 khula ho
- AWS, GCP, Azure jaise bade clouds **default me port 25 block** karte hain (spam rokne ke liye).
- Options: DigitalOcean/Linode/Hetzner/Contabo jaise providers (unse request karke port 25 unblock karwa sakte ho), ya koi VPS jo explicitly "SMTP allowed" bole.
- Bina isske: sending/receiving dono fail honge.

### 2. Apna khud ka domain (e.g. `yourdomain.com`)
- Aap `no-reply@gmail.com` jaisa address use nahi kar sakte — apna domain chahiye.

### 3. DNS records apne domain provider (GoDaddy/Namecheap/Cloudflare) me daalne honge:

| Record | Type | Value | Kaam |
|---|---|---|---|
| `yourdomain.com` | MX | `mail.yourdomain.com` (priority 10) | Batata hai duniya ko ki mail kahan bhejni hai |
| `mail.yourdomain.com` | A | `<aapke VPS ka IP>` | Domain ko server se jodta hai |
| `yourdomain.com` | TXT (SPF) | `v=spf1 ip4:<VPS IP> ~all` | Batata hai ye IP mail bhejne ke liye authorized hai |
| `yourdomain.com` | TXT (DKIM) | (signing key se generate hota hai) | Mail sign karta hai, spam-folder me jaane se bachata hai |
| `_dmarc.yourdomain.com` | TXT | `v=DMARC1; p=none;` | Spoofing policy |
| VPS ka **reverse DNS (PTR)** | — | `mail.yourdomain.com` | Bina isske Gmail/Outlook jaise bade providers aapki mail reject/spam kar dete hain — apne VPS provider ke panel me set karo |

**Note:** SPF/DKIM/DMARC ke bina bhi system technically kaam karega, lekin Gmail/Outlook/Yahoo jaise bade providers aapki mail ko **spam me daal denge ya reject kar denge**. Ye records "reputation" build karne ke liye zaroori hain.

## Deployment options

### Option A — VPS (poora mail server, send+receive dono)
Jaisa pehle bataya, agar aapko real SMTP send+receive chahiye (koi third-party nahi), to ek VPS chahiye
jahan port 25 khula ho, apna domain, aur MX/SPF/DKIM DNS records. Ye section upar hai.

### Option B — Render (recommended agar VPS nahi chahiye)
```bash
# 1. MongoDB Atlas pe free cluster banaye: mongodb.com/atlas -> connection string copy karein
# 2. Repo ko GitHub pe push karein
# 3. Render dashboard -> New -> Blueprint -> is repo ko select karein (render.yaml auto-detect hoga)
# 4. Render dashboard me environment variables set karein: MONGODB_URI, ALLOWED_ORIGIN, MAIL_DOMAIN, MAIL_FROM
```
**Limitation:** Render pe `RUN_MODE=api-only` set hai (render.yaml me) — matlab sirf auth + webmail UI +
database-backed inbox deploy hota hai. Raw SMTP receive/send **nahi chalega**, kyunki Render na koi custom
TCP port 25 expose karta hai, na hi outbound port 25 allow karta hai (paid ho ya free, dono me). Agar
sending chahiye Render se, to ek authenticated SMTP relay (port 587, paid plan pe) use karna hoga — matlab
koi third-party provider zaroor chahiye hoga is route par.

### Option C — Vercel (sirf frontend + API, serverless)
```bash
npm install -g vercel
vercel deploy
```
`vercel.json` already routes `/auth/*`, `/otp/*`, `/messages`, `/message/*`, `/mail/*` ko serverless function
(`api/index.js`) pe, baaki static `public/` se serve hota hai. `MONGODB_URI` aur `JWT_SECRET` Vercel dashboard
me environment variables ke roop me set karein.

**Limitation:** Vercel serverless functions bilkul bhi persistent port listen nahi kar sakte, isliye SMTP
receiving impossible hai yahan. Outbound raw SMTP (port 25) bhi serverless environments me generally blocked
hota hai. Rate limiting bhi per-instance memory me hoti hai — serverless me multiple cold instances ke
across thoda inconsistent ho sakti hai (production-scale ke liye Redis-backed rate limiter better hoga,
jaise `rate-limit-redis`).

### Recommended hybrid (agar poora khud ka mail system + easy hosting dono chahiye)
- Ek chhoti **VPS** sirf `src/receive.js` + `src/send.js` chalane ke liye (SMTP), MongoDB Atlas se connected
- **Render/Vercel** pe baaki sab (auth, webmail UI, API) — same MongoDB Atlas database use karke
- Dono ek hi `MONGODB_URI` share karte hain, isliye VPS pe aaya mail turant Render/Vercel wale UI me dikh jaata hai

## Database (MongoDB)

- `users` collection — email, bcrypt password hash, failed-login counter, lock timestamp
- `messages` collection — from/to (indexed), timestamp, aur subject/body **zlib-compressed Buffer** fields
  (compact storage goal wahi hai jo pehle tha, bas ab SQLite ki jagah MongoDB Atlas hai)
- MongoDB ka `ObjectId` already ek compact 12-byte binary id hota hai (24-char hex sirf display ke liye) —
  koi extra short-id encoding ki zaroorat nahi padi is baar

## Authentication — sab server-side hai

- Password kabhi plaintext store nahi hota — `bcrypt` (cost 12) se hash hota hai.
- Login successful hone par server ek **JWT ek httpOnly, secure, sameSite=strict cookie** me bhejta hai.
  Ye cookie JavaScript se (frontend se) padha ya edit nahi ja sakta — sirf browser use requests ke saath
  automatically bhejta hai.
- Har protected route (`/messages`, `/message/:id`, `/mail/send`) sirf **`req.user.email`** (cookie se decode hua)
  trust karta hai. Frontend chahe kuch bhi bheje body/query me, apni identity change nahi kar sakta.
- 5 galat login attempts ke baad account 15 minute ke liye lock ho jaata hai (per-account, IP rate-limit se alag).
- Forgot-password flow: `/otp/send` → OTP generate hota hai → `/otp/reset-password` me OTP + naya password
  bhejo. OTP 5 minute me expire hota hai, aur verify attempts bhi rate-limited hain.

## Rate limiting (`src/rateLimits.js`)

| Endpoint | Limit |
|---|---|
| `/auth/login` | 8 / 10 min per IP |
| `/auth/signup` | 5 / hour per IP |
| `/otp/send` | 3 / 10 min per IP |
| `/otp/reset-password` (verify) | 10 / 10 min per IP |
| `/mail/send` | 20 / hour per IP |
| Baaki sab | 120 / min per IP |

Har number `src/rateLimits.js` me easily change ho sakta hai jaise aapka traffic grow kare.

## Security headers & hardening

- `helmet` — standard security headers (XSS filter, no-sniff, hide `X-Powered-By`, etc.)
- `cors` — sirf `ALLOWED_ORIGIN` (apka frontend domain) se requests allow karta hai, credentials ke saath
- Request body 100kb tak capped — bade payloads se DoS nahi ho sakta
- SQL: `better-sqlite3` ke prepared statements use hote hain (koi string-concatenated query nahi) —
  SQL injection se safe by design
- `/mail/send` open relay nahi hai — sender hamesha logged-in user hi hota hai (session se), koi bhi
  arbitrary "from" address nahi bhej sakta

## Load balancing (`ecosystem.config.js` + `nginx.conf.example`)

```bash
npm install -g pm2
pm2 start ecosystem.config.js
```

- HTTP API (`mail-api`) `instances: 'max'` — PM2 har CPU core pe ek worker chalata hai aur requests
  round-robin balance karta hai, same port (3000) pe.
- SMTP receiver (`mail-receiver`) jaan-boojhkar **single instance** hai — port 25 ko multiple processes
  share nahi kar sakte jaise HTTP port share hota hai. Agar inbound volume bahut badh jaaye, uske aage
  ek dedicated MTA (Postfix) lagana better hoga.
- `nginx.conf.example` — TLS termination + ek extra request-rate layer edge pe, PM2 cluster ko proxy karta hai.
  Multiple machines pe scale karna ho to upstream block ka example bhi usme hai.

**Ek important limit:** SQLite (jo storage layer use karta hai) safely sirf **ek machine** se likha ja sakta
hai (WAL mode multiple processes ko ek hi machine pe theek se handle karta hai). Agar future me multiple
servers pe scale karna ho, to Postgres/MySQL jaise networked database pe switch karna hoga.

## Storage kitna compact hai

- Email address ek baar `contacts` table me save hoti hai, message me sirf **4-byte integer reference** jaata hai — chahe email kitni bhi lambi ho.
- Subject/body `zlib` se compressed store hote hain.
- Message ID ko duniya ke saamne base62 me dikhaya jaata hai (`1`, `4c92`, etc.) — UUID (36 chars) jaisa bhaari nahi.
- Ek typical OTP mail poore overhead ke saath **~50-80 bytes** ke aas-paas store hoti hai.

## Baaki security notes (production me lagane se pehle)

- `authOptional: true` (`src/receive.js`) sirf incoming-mail acceptance ke liye hai (dusre mail servers
  authenticate nahi karte jab wo aapko mail bhejte hain — ye normal hai). Ye HTTP API ke login/JWT system
  se alag hai. Bas dhyan rahe `onRcptTo` check apki domain ke bahar relay allow na kare — wo already lagा hai.
- `.env` file kabhi git me commit mat karo — `JWT_SECRET` leak hone ka matlab hai koi bhi session forge kar sakta hai.
- `otp.js` OTP value ko API response me kabhi nahi bhejta — sirf actual email ke through jaata hai.

## Security — frontend vs backend split (important)

**Frontend (`public/index.html`) never makes a security decision.** It only:
- collects raw input and sends it to the server
- displays whatever the server sends back, **escaped** before insertion into the page (`esc()` helper - prevents stored XSS from a malicious message subject/body)

**Everything that decides "is this allowed" happens server-side only:**

| Concern | Where it's enforced |
|---|---|
| Is this email/password valid format? | `src/validate.js`, called from every route in `api.js` |
| Is this password strong enough? | `src/validate.js` (8-200 chars) + bcrypt hashing in `src/auth.js` |
| Who am I? | `src/auth.js` `requireAuth` - decoded from the signed httpOnly cookie only, never from any request field |
| Which product does this request belong to? | Browser: from the session cookie. Product backends: from the API key (`src/apiKey.js`) - never from a body field either way |
| Can I open this message? | Ownership check in `api.js` (`msg.to`/`msg.from` must match `req.user`) |
| Can I send from this address? | `from` is always `req.user.identifier` from the session - a client can never claim to be someone else's sender |
| Is this input safe to store? | `src/validate.js` `sanitizePlainText()` strips HTML/script tags and control characters before anything touches the database |
| How many requests can I make? | `src/rateLimits.js`, IP-based, server-side only |
| Is my account locked? | `src/storage.js` `isLocked()` / `recordFailedLogin()` - server tracks and enforces, client just gets an error message |

This means: even if someone bypasses the UI entirely and calls the API directly with curl/Postman, every single check above still applies exactly the same way. The frontend has no special powers the API doesn't already enforce on its own.

## Stored XSS fix (found while hardening this round)

Earlier versions rendered message `subject`/`body`/`from` directly into `innerHTML`. Since messages come from
other users (or other products), a malicious sender could have stored `<script>...</script>` or an
`onerror`-triggering tag as their message content, which would then execute in the recipient's browser when
they opened it. Fixed two ways (defense in depth):
1. **Storage-side**: `sanitizePlainText()` (`src/validate.js`) strips all HTML tags before anything is saved to MongoDB.
2. **Render-side**: the frontend's `esc()` helper HTML-escapes all server-returned text before it's inserted into the page, so even already-stored old data can't execute.

## Additional hardening round (CSP + injection defense)

Testing surfaced two real bugs that are now fixed:

1. **CSP was silently breaking the whole UI.** The strict Content-Security-Policy (`script-src 'self'`,
   no `unsafe-inline`) added earlier would have blocked every `onclick="..."` attribute and the inline
   `<script>` block that the frontend used at the time - a browser would have loaded a dead page. Fixed by
   moving all JavaScript into an external same-origin file (`public/app.js`) and binding every interaction
   with `addEventListener` instead of inline handlers, and moving CSS into `public/style.css` (no inline
   `style="..."` attributes left either). This is what makes a strict CSP actually work instead of just
   being a header that breaks the app.

2. **`express-mongo-sanitize` crashed every single request** (500 error, confirmed by testing) because it
   tries to reassign `req.query`, which this Express version exposes as read-only. Replaced with a small
   dependency-free `src/sanitizeBody.js` that only mutates `req.body` in place (recursively strips any
   `$`-prefixed or dotted key - the actual NoSQL-operator-injection vector) and doesn't touch `req.query`
   at all. Verified with unit tests: strips `{"$ne": null}`-style payloads while leaving normal data untouched.

Also added: `app.set('trust proxy', 1)` so rate limiting and secure cookies see the real client IP/protocol
once this sits behind Render/nginx, rather than always seeing the proxy's own address.
