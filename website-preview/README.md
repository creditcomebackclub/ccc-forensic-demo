# CCC website preview

This directory is the shared source for two deliberately separate Credit Comeback Club marketing artifacts:

- `/site-preview/` is exposed at `/new-site-preview` and remains production-disconnected for owner review.
- `/site-live/` is exposed at the root URL and enables only the approved public-intake → Calendly consultation path plus the existing `/embed.js` chat mount.

The release transformer removes live-only markup from the preview artifact and removes preview ribbon/safety copy from the live artifact. The preview JavaScript contains no network or persistence API.

## Run

From this directory:

    npm run dev

Open http://127.0.0.1:4173.

Use a different local port if needed:

    CCC_PREVIEW_PORT=4180 npm run dev

## Verify

    npm test

The contract tests verify both modes: the inert preview safety boundary and the live artifact's exact intake fields, plan mapping, Calendly prefill, real member/affiliate/legal links, chat mount, service-worker exclusions, and release redirects.

## Preview safety

- The server exposes only the allowlisted HTML, CSS, JavaScript, and owner-provided image assets in this directory.
- The production build copies a strict shared asset allowlist into separate preview and live directories.
- Content Security Policy blocks network connections, form posts, external frames, and remote assets.
- Intake, lead creation, and scheduling are represented with in-memory UI states only.
- The live artifact submits the validated consultation request to `/api/public-intake` before initializing the owner-provided Calendly widget with the entered name and email. Calendly's verified webhook remains responsible for recording an actual booking.
- Production destinations are visible for information architecture review, but clicks are intercepted locally.

## Owner inputs still required

- Final approval of the exact Veteran-Owned & Operated wording and any substantiating business detail.
- Written permission and final approval for every testimonial/evidence image before production publication.
- Claim substantiation for aggregate result metrics before production publication.
- Approved legal and compliance copy for production Terms, Privacy, CROA disclosure, FAQs, and billing statements.

The Calendly destination is already owner-provided and configured in app.js as inert preview data:

    https://calendly.com/creditcomebackclub/consultation?hide_gdpr_banner=1
