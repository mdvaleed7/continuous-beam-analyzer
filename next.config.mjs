/** @type {import('next').NextConfig} */
const nextConfig = {
  // allowedDevOrigins removed: previous entries leaked an Emergent AI sandbox
  // (preview.emergentagent.com / preview.emergentcf.cloud) into the public
  // repository. If you need to re-enable a preview deployment domain, add it
  // here explicitly via an environment variable.
  // allowedDevOrigins: process.env.NEXT_DEV_ORIGINS?.split(',') ?? [],
};

export default nextConfig;
