# CPA Lecturer

A private binder for CPA review materials: upload lecture videos, keep documents you can highlight, and write notes — all backed by Supabase and deployable on Vercel with no build step.

## Stack

- **Front end:** plain HTML5 / CSS3 / vanilla JavaScript (ES modules), no bundler
- **Rich text notes:** [Quill.js](https://quilljs.com/) (CDN)
- **PDF rendering + text selection:** [PDF.js](https://mozilla.github.io/pdf.js/) (CDN)
- **Back end:** Supabase (Postgres + Row Level Security, Auth, Storage)
- **Hosting:** Vercel (static)

## File map

```
index.html            Landing page + sign in / sign up
dashboard.html         Main app shell (Overview, Videos, Documents, Notes)
css/styles.css         Full design system + components
js/config.js            <-- put your Supabase URL + anon key here
js/supabaseClient.js    Creates the Supabase client
js/ui.js                Shared helpers (toasts, formatting)
js/auth.js               index.html logic
js/app.js                dashboard.html shell logic (nav, overview, sign out)
js/videos.js              Lecture video upload, listing, inline rename, playback
js/documents.js            Document upload, PDF/text viewer, highlighting
js/notes.js                Notes list + Quill editor with autosave
schema.sql              Run once in Supabase's SQL editor
```

## 1. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New query**, paste the contents of `schema.sql`, and run it.
   This creates all five tables (`profiles`, `lectures`, `documents`, `highlights`, `notes`),
   enables Row Level Security so each user can only see their own rows, creates the
   `lecture-videos` and `lecture-documents` storage buckets, and adds storage policies
   that restrict each user to a folder named after their own user id.
3. Go to **Authentication → Providers** and confirm **Email** is enabled. (Optional: turn off
   "Confirm email" during development so you can sign up and use the app immediately.)
4. Go to **Project Settings → API** and copy:
   - **Project URL**
   - **anon public** key
5. Paste both into `js/config.js`:
   ```js
   export const SUPABASE_URL = "https://xxxxxxxx.supabase.co";
   export const SUPABASE_ANON_KEY = "eyJhbGciOi...";
   ```

That's the entire back end — there is no server to run. All reads/writes happen straight
from the browser to Supabase, and RLS is what keeps one student's uploads private from another.

## 2. Run it locally

Because the app uses ES modules (`type="module"`), open it through a local server rather
than a `file://` path. Any static server works, for example:

```bash
npx serve .
# or
python3 -m http.server 5500
```

Then visit the printed localhost URL.

## 3. Deploy to Vercel

1. Push this folder to a Git repository (GitHub/GitLab/Bitbucket).
2. In Vercel, **Add New → Project**, import the repo.
3. Framework preset: **Other**. No build command, no output directory override needed —
   it's a static site, so Vercel will serve the files as-is.
4. Deploy. Once live, go back to Supabase → **Authentication → URL Configuration** and add
   your `*.vercel.app` domain (and any custom domain) to the allowed redirect URLs.

## How the features work

- **Videos:** uploaded straight to the private `lecture-videos` bucket under
  `{user_id}/{timestamp}-{filename}`. The card shows the upload date (from the database,
  not the file) and lets you click the pencil icon to rename the lecture title inline —
  saved to Postgres immediately.
- **Documents:** PDF, TXT, or Markdown files go to the `lecture-documents` bucket. Opening
  a PDF renders it page-by-page with PDF.js, including a transparent, selectable text layer.
  Selecting text pops up a small color picker; the chosen highlight is stored as
  page-relative percentage rectangles in the `highlights` table, so it re-draws correctly
  even if the page is re-rendered at a different width. Plain text/Markdown files are
  highlighted by character offset instead of rectangles.
- **Notes:** a Quill.js rich-text note per row in `notes`, autosaved 600ms after you stop
  typing (both the Quill "delta" and a rendered HTML snapshot are stored).

## Extending it

- Add subject-based filtering/search across all three sections using the existing `subject` columns.
- Add a `shared_with` table if you want classmates to see each other's binders.
- Swap the Quill HTML snapshot for exporting notes to PDF using the same PDF.js/print pipeline.
