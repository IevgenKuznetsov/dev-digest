=== Collected dependency data ===

--- @devdigest/api (server/) ---
Package manager: pnpm
Lock file: pnpm-lock.yaml

package.json dependencies:
  fastify@5.1.0
  drizzle-orm@0.36.0
  zod@3.23.8
  pg@8.11.3
  moment@2.29.4

package.json devDependencies:
  vitest@2.1.4
  typescript@5.6.3
  tsx@4.19.0

node_modules total: 854M
Transitive dependency count: 387

pnpm audit: No known vulnerabilities found.

pnpm outdated:
Package     Current   Wanted    Latest
moment      2.29.4    2.29.4    3.0.1
pg          8.11.3    8.11.5    8.13.0
vitest      2.1.4     2.1.8     2.1.8
typescript  5.6.3     5.6.3     5.8.3

--- @devdigest/web (client/) ---
Package manager: pnpm
Lock file: pnpm-lock.yaml

package.json dependencies:
  next@15.0.3
  react@19.0.0
  react-dom@19.0.0
  @tanstack/react-query@5.59.0
  zod@3.22.4
  date-fns@4.1.0

package.json devDependencies:
  vitest@2.1.4
  typescript@5.6.3
  tailwindcss@3.4.14

node_modules total: 2.4G
Transitive dependency count: 1243

pnpm audit: No known vulnerabilities found.

pnpm outdated:
Package       Current   Wanted    Latest
tailwindcss   3.4.14    3.4.17    4.1.3
next          15.0.3    15.0.3    15.4.0
vitest        2.1.4     2.1.8     2.1.8
typescript    5.6.3     5.6.3     5.8.3

--- @devdigest/reviewer-core (reviewer-core/) ---
Package manager: npm
Lock file: package-lock.json

package.json dependencies:
  zod@3.23.8

package.json devDependencies:
  typescript@5.6.3

node_modules total: 312M

npm audit: No known vulnerabilities found.

npm outdated:
Package     Current   Wanted    Latest
typescript  5.6.3     5.6.3     5.8.3

--- @devdigest/e2e (e2e/) ---
Package manager: npm
Lock file: package-lock.json

package.json dependencies: (none)

package.json devDependencies:
  playwright@1.48.2
  typescript@5.6.3

node_modules total: 680M

npm audit: No known vulnerabilities found.

npm outdated:
Package      Current   Wanted    Latest
playwright   1.48.2    1.48.2    1.51.0
typescript   5.6.3     5.6.3     5.8.3
