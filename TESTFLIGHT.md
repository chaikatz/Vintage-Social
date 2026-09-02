# VINTAGE → TestFlight

The repo side is done and verified. What remains needs credentials that only
exist on your machine: an Expo account, and Apple Developer / App Store
Connect access. Nothing below asks you to paste a secret anywhere.

| | |
| --- | --- |
| Bundle ID | `com.vintage.social` |
| Display name (home screen) | `Vintage` |
| App Store Connect listing | `Vintage Social` |
| Version | `1.0.0` |
| Build number | managed by EAS (`appVersionSource: remote`, `autoIncrement: true`) |
| Production profile | `distribution: store`, `environment: production`, `EXPO_PUBLIC_DEMO_MODE=0` |
| EAS project | `7d93bd28-2dec-4e7f-8f05-dc2f8c2ecd5f` (owner `chaikatz`) |

---

## Before the first build: two things that will otherwise bite

**1. ~~Link the project to EAS.~~** Done — `app.json` now carries
`extra.eas.projectId 7d93bd28-2dec-4e7f-8f05-dc2f8c2ecd5f` under owner
`chaikatz`.

**2. Set the production Supabase variables in EAS.** This is the one that
turns into a crash rather than a warning. The production profile sets
`EXPO_PUBLIC_DEMO_MODE=0`, and `src/lib/env.ts` throws at startup when demo
mode is off and there is no backend configured — so a build without these
installs fine and dies the moment you open it.

```bash
eas env:list --environment production          # check first

eas env:create --environment production \
  --name EXPO_PUBLIC_SUPABASE_URL \
  --value "https://scfwowqsqrnzpknzurmm.supabase.co"

eas env:create --environment production \
  --name EXPO_PUBLIC_SUPABASE_ANON_KEY \
  --value "<anon key from Supabase → Vintage-Production → Project Settings → API>" \
  --visibility sensitive
```

That URL is production, deliberately — **not** the staging project
(`omvezsrkjizxdfeogccw`). Your local `.env` has no bearing on this: it is
gitignored, EAS uploads only what git tracks, and `.env.staging` — which is
tracked — is never auto-loaded, because Expo only reads `.env`,
`.env.local` and `.env.production`.

---

## Build and submit

```bash
eas login
eas build --platform ios --profile production
```

EAS will ask to create the iOS distribution certificate and provisioning
profile; let it. Then:

```bash
eas submit --platform ios --latest
```

It will ask for your Apple ID, the App Store Connect app ID for
`Vintage Social`, and your team ID. To skip the prompts on later runs, put
them in `eas.json` under `submit.production.ios` — Apple IDs and team IDs
are not secrets, so they are fine to commit; app-specific passwords are not,
and belong in `EXPO_APPLE_APP_SPECIFIC_PASSWORD` instead.

Processing in App Store Connect takes roughly 5–15 minutes after upload.
`ITSAppUsesNonExemptEncryption` is already `false`, so you will not be asked
the export-compliance question on every build.

---

## Installing it on your iPhone

1. App Store → install **TestFlight** (Apple's own app), sign in with the
   Apple ID on your developer account.
2. App Store Connect → **Vintage Social** → **TestFlight** → the build →
   under *Internal Testing*, add yourself as a tester. Internal testing
   needs no Beta App Review.
3. On the phone, open **TestFlight** → **Vintage** → **Install**.

The home-screen icon will read **Vintage**.

---

## Before submitting for App Store review

Not TestFlight blockers — internal testing needs none of them — but review
will stop on all four.

- **In-app account deletion.** Guideline 5.1.1(v): any app with account
  creation must let a user delete their account from inside the app. There
  is no such flow.
- **Blocking another member.** Guideline 1.2 for user-generated content
  requires a way to block an abusive user. Reporting exists; blocking does
  not.
- **Privacy policy URL.** Required at submission, and it has to describe the
  photo-library access and the EXIF capture dates the app reads.
- **Privacy nutrition labels** in App Store Connect, covering photos, email
  and user content.

Two smaller things worth a look before review:

- `NSFaceIDUsageDescription` is boilerplate from `expo-secure-store`
  ("Allow $(PRODUCT_NAME) to access your Face ID biometric data"). The app
  does not use Face ID; a generic Apple-template string sometimes draws a
  rejection.
- The permission prompts say "VINTAGE" while the app is now named
  "Vintage". Cosmetic, and only visible in the system dialogs.
