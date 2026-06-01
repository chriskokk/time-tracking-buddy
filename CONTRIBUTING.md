# Contributing to Time-Tracking Buddy

Thanks for your interest. This is a personal project released as-is, with limited
support — issues and pull requests are welcome, but please understand that
responses may be slow and not every change will be merged.

## Build and run

Requirements: [Node.js](https://nodejs.org/) 20 or newer.

```bash
git clone https://github.com/chriskokk/time-tracking-buddy.git
cd time-tracking-buddy
npm install
npm run dev          # run the app in development
```

Build a Windows installer:

```bash
npm run build:win    # output in dist/
```

## Before opening a pull request

- Keep changes focused; one logical change per PR.
- Make sure the project type-checks and builds:

  ```bash
  npm run typecheck   # tsc over main + renderer
  npm run build       # electron-vite production build
  ```

- Match the existing code style. TypeScript strict mode is on; avoid `any`
  without a short comment explaining why.
- Describe what the change does and why in the PR description.

## Reporting issues

Open an issue with your OS, the app version, and clear steps to reproduce.
Because the app captures window titles locally, please redact anything sensitive
from logs or screenshots before attaching them.

## License

By contributing, you agree that your contributions will be licensed under the
GNU Affero General Public License v3.0, the same license as the project.
