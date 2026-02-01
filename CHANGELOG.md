# Changelog

## [1.1.0](https://github.com/borgius/opencode-claude-max-proxy/compare/v1.0.2...v1.1.0) (2026-02-01)


### Features

* add detailed logging for debugging ([4c8478f](https://github.com/borgius/opencode-claude-max-proxy/commit/4c8478fbfbb2907dddf81ae05c32319fd4ff82a0))
* add persistent Claude process for faster responses (v5) ([3ba63a5](https://github.com/borgius/opencode-claude-max-proxy/commit/3ba63a5e7e744055c9725c0a14fb2ce453244d29))
* add true streaming support with stream-json protocol ([3b77ac4](https://github.com/borgius/opencode-claude-max-proxy/commit/3b77ac4220fd5109e70cfa8e37c1e0f801380169))
* add update-creds.sh for automatic credential updates ([56527e2](https://github.com/borgius/opencode-claude-max-proxy/commit/56527e29a6f912431061efe4d9d5622ea77499f1))
* add v6 - persistent process without sessions ([fcb531a](https://github.com/borgius/opencode-claude-max-proxy/commit/fcb531a247fbe702fcbb0eb6ec3be021c14608ac))
* implement lazy loading for ClaudeManager and update async handling in request handlers ([5d4e53b](https://github.com/borgius/opencode-claude-max-proxy/commit/5d4e53b814001aa83d21babb973da2e61fc283fa))
* migrate to Cloudflare Containers with Claude Max OAuth ([ed4a4ec](https://github.com/borgius/opencode-claude-max-proxy/commit/ed4a4ecee104c1042007eb69a487e61dbe9197d9))
* remove deprecated local test scripts and update integration tests ([85ab577](https://github.com/borgius/opencode-claude-max-proxy/commit/85ab577e8168129c89033f3bed9a3121415f9862))
* remove legacy container server implementations and refactor to a new structure ([cdef589](https://github.com/borgius/opencode-claude-max-proxy/commit/cdef5897915bb885f53ba5c4f886187d62566535))
* restore MCP tool federation for multi-turn agent sessions ([099a830](https://github.com/borgius/opencode-claude-max-proxy/commit/099a830ca7f48d060db4acd923cebee68a3e7fd0))
* restore Node.js proxy server with Anthropic integration ([8fe459a](https://github.com/borgius/opencode-claude-max-proxy/commit/8fe459a7d1ffdedb72d1d827ff5043bd515e7d8e))
* **tests:** add comprehensive test suite for health, models, OpenAI chat, and server middleware ([98122f0](https://github.com/borgius/opencode-claude-max-proxy/commit/98122f0fe759e88c2ef61a972fbdee36611675f1))
* **tests:** enhance e2e testing with remote proxy support and auth headers ([8b301fa](https://github.com/borgius/opencode-claude-max-proxy/commit/8b301fa807b67efb691806b632a29bceea433f9b))


### Bug Fixes

* add error handling and container ready check ([0c35929](https://github.com/borgius/opencode-claude-max-proxy/commit/0c35929c1e870f5405385a7a8bd90394193d3912))
* add path and tag to wrangler containers build ([88fcc92](https://github.com/borgius/opencode-claude-max-proxy/commit/88fcc922bc358f6bcb29bc5c39fc85d0491d4461))
* bind server to 0.0.0.0 and add error handling ([3482dd8](https://github.com/borgius/opencode-claude-max-proxy/commit/3482dd8c81a68c6c64579fa303568daca5860f79))
* change containers from array to object format ([7205834](https://github.com/borgius/opencode-claude-max-proxy/commit/7205834bbc01770a2c8a3fbc98920e5d3ba4e89f))
* change containers from array to object format ([3c19194](https://github.com/borgius/opencode-claude-max-proxy/commit/3c19194ada9fccc699ba3c8d93cd8e090619b09e))
* change worker name to match domain ([880b957](https://github.com/borgius/opencode-claude-max-proxy/commit/880b9579bb0df80eb004146e32c30297bee3cdfa))
* convert wrangler.toml to wrangler.jsonc format ([3fceeb7](https://github.com/borgius/opencode-claude-max-proxy/commit/3fceeb78e87e72921e26d6f8aec96e8182796cf3))
* disable all tools in Claude Code sessions ([7fab74c](https://github.com/borgius/opencode-claude-max-proxy/commit/7fab74ca05e95124d6ea75bc95314cbcea51d118))
* extend Container class with defaultPort ([d126f6f](https://github.com/borgius/opencode-claude-max-proxy/commit/d126f6fbc6d268ffbc2d288a9d7a3baa82ee54b5))
* handle nested OAuth credentials structure ([cf7bca0](https://github.com/borgius/opencode-claude-max-proxy/commit/cf7bca04cb4e55d5f6464556b27c9fb96dd3104b))
* include system prompt context in proxy requests ([948b8fb](https://github.com/borgius/opencode-claude-max-proxy/commit/948b8fb64c6a3d6d8e7434d668334eaee78258fa))
* keep X-OAuth-Creds header when forwarding to container ([f1d6aaa](https://github.com/borgius/opencode-claude-max-proxy/commit/f1d6aaaf5638163054a0bba5d5f55b49ffa6fd4e))
* pass OAuth creds via header and implement container startup ([075fdcd](https://github.com/borgius/opencode-claude-max-proxy/commit/075fdcdaf5723408da713d2edbd1083b0d18a1ef))
* read OAuth creds from request header as fallback ([dc78076](https://github.com/borgius/opencode-claude-max-proxy/commit/dc78076a333a9576216cb97661847c686565850e))
* reduce wait time to 10s to avoid DO timeout ([3b87906](https://github.com/borgius/opencode-claude-max-proxy/commit/3b87906d960afb618543945f285d02697bcbfe76))
* remove broken wrangler auth, use env vars ([81efcdc](https://github.com/borgius/opencode-claude-max-proxy/commit/81efcdcf9940d3adf4d505ba02bc55275a2d632c))
* resolve Claude executable path and enable true SSE streaming ([d95bacb](https://github.com/borgius/opencode-claude-max-proxy/commit/d95bacbc0b2a60f78e11086d9979ff1374383b78))
* run container as non-root user for Claude CLI compatibility ([2f6cd19](https://github.com/borgius/opencode-claude-max-proxy/commit/2f6cd198df530cd5aab5b5c1a9a9e88e89358a18))
* simplify worker and add better error handling ([343ca18](https://github.com/borgius/opencode-claude-max-proxy/commit/343ca18637684214a1b643ecce898755ad237d7d))
* **tests:** improve error handling and update health endpoint tests for remote compatibility ([47fd782](https://github.com/borgius/opencode-claude-max-proxy/commit/47fd78201dd64b8614329a579373d06568f541f5))
* update SDK and fix streaming to filter tool_use blocks ([ae4d7ea](https://github.com/borgius/opencode-claude-max-proxy/commit/ae4d7ea4614f5f0774d505385b6248dbcbc65bc5))
* use Bearer auth for OAuth tokens instead of x-api-key ([508817c](https://github.com/borgius/opencode-claude-max-proxy/commit/508817ccd9a8700a868f3e8e3f07eb9285adc5c1))
* use Claude CLI with proper flags for non-interactive mode ([35a6dc9](https://github.com/borgius/opencode-claude-max-proxy/commit/35a6dc9e7b9c055808cf9bb1921478d89e324892))
* use CommonJS for container server (.cjs) ([631c7af](https://github.com/borgius/opencode-claude-max-proxy/commit/631c7afeb052112657f1637ea49afbde648a62cc))
* use correct Cloudflare Containers API (ctx.container) ([6e97f52](https://github.com/borgius/opencode-claude-max-proxy/commit/6e97f52e3d9da173671858e48c92b4f434a0356e))
* use correct Container class API with containerFetch ([e3d08f8](https://github.com/borgius/opencode-claude-max-proxy/commit/e3d08f820dedec77f464c334d5f95ef26c6f4277))
* use port.fetch() instead of building URLs ([3741bb6](https://github.com/borgius/opencode-claude-max-proxy/commit/3741bb660c3c1ebb5989c8c542b3adcfcac25c50))
* use proper Durable Object storage API ([e9251b1](https://github.com/borgius/opencode-claude-max-proxy/commit/e9251b11457f4408d06daca18e81da054b10f3da))


### Performance Improvements

* add --no-session-persistence flag to reduce CLI overhead ([311be19](https://github.com/borgius/opencode-claude-max-proxy/commit/311be19244465f5a6888197d9149020c6040de2b))
* add sleepAfter=5m to keep container warm ([e7df7b2](https://github.com/borgius/opencode-claude-max-proxy/commit/e7df7b222841ce81f7ec0b2f91faf9ec38f68669))

## [1.0.2](https://github.com/rynfar/opencode-claude-max-proxy/compare/v1.0.1...v1.0.2) (2026-01-26)


### Bug Fixes

* remove bun install from publish job ([966b2ea](https://github.com/rynfar/opencode-claude-max-proxy/commit/966b2ea8a06f4dc12dd4f0f19be94b3539b83dfd))
* remove bun install from publish job ([cd36411](https://github.com/rynfar/opencode-claude-max-proxy/commit/cd36411193af22e779638232427dd8c49f8926e0))

## [1.0.1](https://github.com/rynfar/opencode-claude-max-proxy/compare/v1.0.0...v1.0.1) (2026-01-26)


### Bug Fixes

* move npm publish into release-please workflow ([82db07c](https://github.com/rynfar/opencode-claude-max-proxy/commit/82db07c07bf87bfc69ae08cc8f24c007408ad3ed))
* move npm publish into release-please workflow ([f7c4b2c](https://github.com/rynfar/opencode-claude-max-proxy/commit/f7c4b2c08a6993d20239e63b9fb668017577ab32))

## 1.0.0 (2026-01-26)


### Features

* Claude Max proxy for OpenCode ([b9df612](https://github.com/rynfar/opencode-claude-max-proxy/commit/b9df6121564b90b3dbbf821f981d67851d7a4e1e))


### Bug Fixes

* add SSE heartbeat to prevent connection resets ([194fd51](https://github.com/rynfar/opencode-claude-max-proxy/commit/194fd51e2fdf375cbac06fbfcf634800adab5d72))
* add SSE heartbeat to prevent connection resets ([ec7120d](https://github.com/rynfar/opencode-claude-max-proxy/commit/ec7120d22eef490e146530e5d66c1d90b055d0b5)), closes [#1](https://github.com/rynfar/opencode-claude-max-proxy/issues/1)
