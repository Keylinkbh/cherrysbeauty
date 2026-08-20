# Cherrys Beauty Lounge — Setup Guide

This turns your salon app into a real, installable app on your phone and
laptop, with one shared database so both stay in sync. Takes about 15
minutes, no coding needed — just following steps.

## What you're setting up
- **Supabase** — a free database that stores all your app's data and keeps
  every device in sync automatically.
- **Netlify** — a free host that gives your app a real web address.
- Then you **install** that web address as an app icon on your phone and
  laptop.

---

## Step 1 — Create your free database (Supabase)

1. Go to **supabase.com** and sign up (free, no credit card).
2. Click **New Project**. Give it any name, set a database password
   (save it somewhere), pick a region close to Bahrain, click **Create**.
   Wait ~2 minutes while it sets up.
3. In the left sidebar, click the **SQL Editor** icon.
4. Click **New query**, then open the `schema.sql` file from this folder,
   copy all of it, paste it into the editor, and click **Run**.
   You should see "Success. No rows returned."
5. In the left sidebar, go to **Project Settings → API**.
6. You'll see two things you need:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **anon public** key (a long string under "Project API keys")

## Step 2 — Add those to your app

1. Open **`config.js`** in this folder (any text editor, even Notepad).
2. Replace:
   ```js
   export const SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
   export const SUPABASE_ANON_KEY = "YOUR-ANON-PUBLIC-KEY";
   ```
   with the Project URL and anon public key from Step 1.
3. Optionally change `APP_PIN` to a 4-6 digit code your staff will enter
   to open the app. Leave it as `""` (empty quotes) if you don't want a
   PIN screen at all.
4. Save the file.

## Step 3 — Put it online (Netlify)

1. Go to **app.netlify.com** and sign up free.
2. On the dashboard, look for **"Add new site" → "Deploy manually"**
   (sometimes just a big dashed box that says "drag and drop your site").
3. Open this whole folder on your computer, select **all the files inside
   it** (index.html, app.js, config.js, manifest.json, sw.js, the icons —
   everything except SETUP-GUIDE.md and schema.sql, though it's fine if
   those come along too), and **drag them into that box**.
4. Netlify gives you a live web address in a few seconds, like
   `https://cherrys-beauty-lounge.netlify.app`. That's your app's address —
   bookmark it, and open it to try it out.
   - Optional: in Netlify, under **Site settings → Change site name**, you
     can pick a nicer name for the address.

## Step 4 — Install it on your phone and laptop

**On your phone (Android/Chrome):**
Open the Netlify address in Chrome → tap the **⋮** menu → **"Add to Home
screen" / "Install app"**. It now sits on your home screen like a normal app.

**On your phone (iPhone/Safari):**
Open the address in Safari → tap the **Share** icon → **"Add to Home
Screen"**.

**On your laptop (Chrome or Edge):**
Open the address → look for an **install icon (⊕ or a little monitor)** in
the address bar → click it → **Install**. It opens in its own window from
then on, separate from your browser tabs.

That's it — same address, same data, on every device.

---

## About security

The **PIN screen** stops someone from casually opening the app if they
find the link — but it's enforced only in the browser, not the database.
The real gatekeeper is your Supabase **anon key**, which — because it's
built into the app for anyone to use — technically lets anyone who has
your app's web address read and write your data if they went looking for
it. For a small internal team tool, keeping the URL private (don't post
it publicly) plus the PIN screen is a reasonable, practical level of
protection.

If you'd like proper lock-and-key security later — real staff logins,
different permissions for staff vs. owner — that's a further step using
**Supabase Auth**, and I'm happy to build that in whenever you're ready.

## Updating the app later

If you ever want changes (new features, design tweaks): I'll give you an
updated `app.js` (and any other changed file) — just drag the updated
files into Netlify the same way as Step 3, and it re-deploys in seconds.
Your Supabase database and all its data stay exactly as they are; only
the app code changes.

## Troubleshooting

- **"Setup needed" screen on open** → `config.js` still has the
  placeholder text; redo Step 2.
- **Blank screen** → open your browser's dev console (F12) and check for
  a red error; usually it means the Supabase URL/key was pasted with a
  typo or extra space.
- **Changes on phone don't show on laptop** → make sure both are using
  the exact same Netlify address, and that you're online (data needs an
  internet connection to sync — it isn't stored on the device).
