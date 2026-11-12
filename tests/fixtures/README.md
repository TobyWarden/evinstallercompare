# Test fixtures — NOT REAL DATA

Made-up installers and approximate town centres used only by `npm run test:build`.
Every row's `source` contains `TEST FIXTURE`. The live build (`npm run build`) fails if:

- `DATA_DIR` is set, or
- any row in `/data` has a `TEST FIXTURE` source, or
- any fixture company name, slug or marker appears in the built site.

Never copy these rows into `/data`.
