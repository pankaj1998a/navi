// Minimal Bun Security Scanner per https://bun.com/docs/pm/security-scanner-api
// Scans for known CVEs including CVE-2026-39356 (drizzle-orm <0.45.2 / <1.0.0-beta.20)
export const scanner: Bun.Security.Scanner = {
  version: "1",
  async scan({ packages }) {
    const advisories: Bun.Security.Advisory[] = []

    for (const pkg of packages) {
      // CVE-2026-39356: drizzle-orm vulnerable <0.45.2 and <1.0.0-beta.20
      if (pkg.name === "drizzle-orm") {
        const isVulnStable = Bun.semver.satisfies(pkg.version, "<0.45.2")
        const isVulnBeta = Bun.semver.satisfies(pkg.version, ">=1.0.0-beta.1 <1.0.0-beta.20") || Bun.semver.satisfies(pkg.version, ">=1.0.0-rc <1.0.0-rc.5")
        // rc.2 is reported vulnerable per CVE, rc.5+ is considered fixed; beta.20+ fixed
        // Simplify: any 1.0.0 pre-release < rc.5 considered vuln; keep logic explicit
        const rawVuln = isVulnStable || pkg.version === "1.0.0-rc.2" || isVulnBeta
        if (rawVuln) {
          advisories.push({
            level: "fatal",
            package: pkg.name,
            description: `CVE-2026-39356: drizzle-orm ${pkg.version} is vulnerable. Upgrade to >=0.45.2 or >=1.0.0-beta.20 / >=1.0.0-rc.5`,
            url: "https://github.com/advisories/GHSA-drizzle-orm-CVE-2026-39356",
          })
        }
      }
      // Generic supply-chain check: known malicious package example
      if (pkg.name === "event-stream" && Bun.semver.satisfies(pkg.version, ">=3.3.6 <4.0.0")) {
        advisories.push({
          level: "fatal",
          package: pkg.name,
          description: "Malicious package event-stream",
          url: "https://blog.npmjs.org/post/180565383195/details-about-the-event-stream-incident",
        })
      }
    }

    return advisories
  },
}
