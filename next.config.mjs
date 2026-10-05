/** @type {import('next').NextConfig} */
const nextConfig = {
  // The Email tab's PDFs (0131): pdfmake and the pdfkit under it read their
  // own data files at run time, so they load from node_modules as published
  // rather than through the bundler.
  serverExternalPackages: ["pdfmake", "pdfkit"],

  // app.reservationcentric.com used to serve the previous PMS, whose login
  // was /client/#/login. The browser never sends the "#/login" part, so
  // every old bookmark arrives here as /client: send it to our login, which
  // forwards a signed-in user on to the dashboard.
  async redirects() {
    return [
      { source: "/client", destination: "/login", permanent: false },
      { source: "/client/:path*", destination: "/login", permanent: false },
    ];
  },
};
export default nextConfig;
