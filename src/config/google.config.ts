import { registerAs } from '@nestjs/config';

export default registerAs('google', () => ({
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
  driveRootFolderId: process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID,
  // The dashboard origin that will PUT the file bytes directly to the Drive
  // resumable-upload session this backend creates. Drive only returns
  // Access-Control-Allow-Origin on that later PUT when the session was
  // created with this Origin header set — without it, the upload still
  // succeeds server-side but the browser can't read the response (looks
  // like "Failed to fetch" client-side).
  dashboardOrigin: process.env.DASHBOARD_ORIGIN,
}));
