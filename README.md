# Roblox Asset Uploader (Vercel)

## Endpoints compatible with the Luau example
- `POST /api/upload`
- `POST /api/status`
- `POST /api/get`

## Deploy
1. Upload this folder to a GitHub repository.
2. Import the repository in Vercel.
3. Deploy; no environment variables are required because each request supplies its own Roblox Open Cloud API key.
4. Test `https://YOUR-DOMAIN.vercel.app/`.

## Important
- The API key is not written to a database or intentionally logged. It is sent in the request body to this backend over HTTPS, then used as the `x-api-key` header to Roblox. Serverless platform request logging and third-party infrastructure are outside this code's control; do not submit a key unless you trust the deployment.
- Use a Roblox Open Cloud API key with the required asset creation permissions and correct creator access.
- `fileUrl` must be a direct HTTPS URL ending in `.rbxm` or `.rbxmx`, publicly downloadable without cookies, and the file must be at most 20 MB.
- Roblox may change API response schemas. `/api/get` uses an asset details endpoint which may not expose moderation state for every asset/key. The creation operation's response is the primary source for moderation data.
- Do not let untrusted players submit arbitrary keys or uploads from a published game. The Luau RemoteFunction must be restricted server-side and this public API should be protected against abuse before public deployment.
