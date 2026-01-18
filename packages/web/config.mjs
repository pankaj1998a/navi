const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://navi.ai" : `https://${stage}.navi.ai`,
  console: stage === "production" ? "https://navi.ai/auth" : `https://${stage}.navi.ai/auth`,
  email: "contact@anoma.ly",
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/anomalyco/navi",
  discord: "https://navi.ai/discord",
  headerLinks: [
    { name: "Home", url: "/" },
    { name: "Docs", url: "/docs/" },
  ],
}
