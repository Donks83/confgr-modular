# A permanent link, for nothing

The demo has been living on a Cloudflare quick tunnel, which dies whenever this
machine sleeps and comes back with a different four-word name. That is fine for
holding a phone next to a laptop and useless as a link in an email. This puts
the same thing somewhere that does not care whether the machine is awake.

**Cost: £0.** Netlify's Free plan states that commercial projects are allowed,
which matters because this is PWS work rather than a hobby.

## Why Netlify and not the others

| | verdict |
|---|---|
| **Cloudflare Pages** | Better static host, cannot run this. Its free functions get **10 ms of CPU** per request and building a model takes about 120 ms of real work. |
| **Vercel Hobby** | Free tier is **"non-commercial, personal use only"** in their own terms. Not a grey area for company work. |
| **GitHub Pages** | Static only, so AR would cover the opening product and nothing else. |
| **Netlify Free** | Runs the AR route. 125,000 function calls a month, 100 GB bandwidth, 10 seconds per call against the ~250 ms this needs. |

## What you have to do, and why it is you

Two accounts, because **nobody should be creating accounts in your name** — not
me, not anything else. Everything on either side of these steps is already
built and tested.

### 1. Netlify (about two minutes)

1. Sign up at **netlify.com** with your work email. No card.
2. Double-click **`Deploy to Netlify.bat`** in this folder.
3. The first run opens a browser to authorise, then asks whether to create a new
   site. Say yes, and take the name it offers or set your own.

It prints the address when it finishes. That address is permanent: it survives
this machine sleeping, and it does not change on the next deploy.

To update it later, after changing anything, double-click the same file.

### 2. Cloudflare Access, so only invited people get in (about ten minutes)

**Do this before sending the link to anyone.** Until you do, the site is public,
and that means Kesseböhmer's geometry is downloadable by anyone who has or finds
the URL. They are a partnership prospect rather than a customer, and this is
their range.

Cloudflare's Zero Trust free tier covers **up to 50 users**:

1. Sign up for **Cloudflare Zero Trust** (free plan, choose it explicitly).
2. **Access → Applications → Add an application → Self-hosted**, pointed at the
   Netlify address.
3. Add a policy: **Allow**, with the rule **Emails** and the addresses of the
   people who should get in. Your own, Craig's, whoever else.

Each of them gets a one-time code by email the first time they open it. No
password to create, nothing to install.

> This step needs the Netlify site to sit on a domain Cloudflare manages, so if
> you would rather not buy one (about £10 a year), the alternative is to leave
> the site public and treat the URL itself as the only thing keeping it quiet.
> That is a judgement about Kesseböhmer rather than a technical choice, and it
> is yours.

## What is already done

- **The AR route runs as a Netlify function** (`netlify/functions/ar.mjs`),
  calling the same two functions the laptop version calls. Nothing about the
  product is decided differently.
- **It fits.** Bundled the way Netlify bundles it, the function is **676 kB**,
  and with the 27 part models the deployable zip is **1.19 MB** against a 50 MB
  cap. Measured, not estimated — three.js is 35 MB on disk and almost all of it
  is unreachable from here.
- **It is tested before it is deployed** (`tests/arFunction.test.js`, 10 tests):
  a three-bay product comes back as a real GLB and a real USDZ, a bad id gets a
  named 422, and the paths the function claims are asserted to be the same paths
  `arRouteUrl` builds. A function you first test by deploying it is a function
  you debug through a log viewer.
- **The deploy exports the bundle first**, locally, with `--ar-route`, so what
  goes up is a folder you could have opened yourself.

## Two things that are worse than the laptop version

- **Cold starts.** The first AR tap after a quiet spell waits a second or two
  while the function wakes.
- **The cache is weaker.** On the laptop a model built once is cached on disk
  for ever. A function caches in `/tmp`, which belongs to one instance and
  evaporates, so a configuration is occasionally rebuilt. Netlify's own edge
  cache takes most of that back, because a configuration id names one product
  for ever and the response says so.

## Why the deploy uploads rather than builds

The part models are derived from Kesseböhmer's CAD and are deliberately not in
git, so a build running on Netlify's servers from a git checkout would have no
geometry. `netlify deploy` uploads what is on disk, which is exactly right here
and is why there is no build command in `netlify.toml`.
