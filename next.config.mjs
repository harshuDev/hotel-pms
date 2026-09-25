/**
 * APP_BUILD is the "build: 20260925-3af248fd" line in the user menu, the same
 * shape the client's reference system shows there.
 *
 * Worked out once here, at build time, and inlined by Next into the server
 * and browser bundles alike -- so the two renders cannot disagree and there
 * is no hydration mismatch. The date is the build's own UTC day, and the hash
 * is the deployed commit Vercel builds from. Off Vercel there is no commit to
 * name, so it says "local" rather than inventing one.
 *
 * It exists for support. Once hotels are logged in, the first question on any
 * report of a fault is which version they are looking at, and this answers it
 * without anybody having to know where Vercel keeps that.
 */
const buildDay = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const commit = (process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 8);

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    APP_BUILD: `${buildDay}-${commit}`,
  },
};

export default nextConfig;
