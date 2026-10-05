/** @type {import('next').NextConfig} */
const nextConfig = {
  // The Email tab's PDFs (0131): pdfmake and the pdfkit under it read their
  // own data files at run time, so they load from node_modules as published
  // rather than through the bundler.
  serverExternalPackages: ["pdfmake", "pdfkit"],
};
export default nextConfig;
