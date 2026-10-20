# Weekend Escape

Static landing page with Node.js Vercel Functions. Use Node.js 24.

## Local development

Run `npm run dev` from the repository root. No dependencies or credentials are
needed for this first stage. The server binds to the loopback interface on port
3000; set the process variable `PORT` to choose another port.

- `/` and `/weekend-escape.html` serve the original website.
- `GET /api/health` returns `{"status":"ok","service":"weekend-escape"}`.
- Other routes return 404. The local harness only exposes the page and health
  handler, not repository documentation or configuration files.

The local server is a development harness, not the Vercel runtime. Verify a Vercel
preview deployment before treating platform routing and function packaging as tested.

## Vercel

Use the repository root as the Vercel project root, Node.js 24, and the Other
framework preset. `vercel.json` runs `npm run build`, publishes `public/`, maps
`/` to the original page, and leaves `/api/health` as a Node.js Function.
The build copies only the website into `public/`; do not place secrets there.

Check a preview deployment: the homepage and original HTML path should load;
`/api/health` should return 200; POST to it should return 405. Repository files
such as `/README.md` and `/package.json` should return 404. Complete the quiz,
check email/consent validation, unlock the demo itinerary, and restart.

## Configuration and scope

Do not create any `.env` files, including `.env.local` or `.env.example`.
Manage deployment credentials in Vercel environment settings. If later needed
locally, inject them into the process without writing files or exposing values.
Do not use `vercel env pull`. No credentials are needed for the current stage.

The form still simulates submission: no lead is stored and no email is sent.
The Supabase schema and its verification instructions are in
[`supabase/README.md`](supabase/README.md). Apply it to the intended development
Supabase project before connecting the form. Run `npm run test:database` with
Python 3 and Docker available to test the migration in a disposable PostgreSQL
17 container. This test never connects to Supabase or uses real credentials.

Gmail, admin authentication, and scheduled follow-ups are later stages.
Health reports only that the function runs; it does not check those services.
No cron schedule or email dependencies are enabled yet.
