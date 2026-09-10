# Local development

The pinned toolchain is Node 24.16.0 and npm 11.13.0. From the repository root:

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run dev
```

The development server is bound to `127.0.0.1:4173`. The default Studio mode is the explicit fixture adapter. Select Compatibility, choose Live owner API, provide a bearer token and the authenticated owner subject in memory for the current tab, and check the connection when a loopback server is available. The live adapter only uses relative `/v1` paths. The subject must match the owner identity bound to the token because the harness checks it on every control command.

The static output is `dist/`. Build output does not contain source maps or credentials. This repository does not deploy or start the harness automatically.
