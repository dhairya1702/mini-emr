/**
 * Where early-access submissions go.
 *
 * We use Web3Forms — a free, static-site-friendly relay that emails each
 * submission to your inbox. It is CORS-safe from the browser and the access
 * key is meant to be public (it only lets people SEND to your form, not read
 * anything), so it is safe to ship in client code and commit to git.
 *
 * GO LIVE (30 seconds, only you can do this — it needs email verification):
 *   1. Open https://web3forms.com
 *   2. Enter  dhairya911@gmail.com  and submit.
 *   3. Web3Forms emails you an "Access Key" (a UUID). Paste it below.
 *   4. Deploy. Submissions now arrive at dhairya911@gmail.com.
 *
 * Until a real key is set, the form runs in DEMO mode (no network, simulated
 * success) so the live site never shows a broken form.
 */
export const WEB3FORMS_ACCESS_KEY = "889e28dd-82d0-4d2d-af51-afe9d0863713";

/** Destination inbox — informational; actual delivery is tied to the key above. */
export const ACCESS_EMAIL = "dhairya911@gmail.com";

/** Web3Forms submit endpoint (do not change). */
export const WEB3FORMS_ENDPOINT = "https://api.web3forms.com/submit";

/** True once a real key has been pasted in (not the placeholder). */
export const ACCESS_LIVE =
  WEB3FORMS_ACCESS_KEY.length > 20 &&
  !WEB3FORMS_ACCESS_KEY.startsWith("PASTE_");
