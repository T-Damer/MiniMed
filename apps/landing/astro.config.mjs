import { defineConfig } from 'astro/config';

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/').at(-1);
const inferredBase =
  process.env.GITHUB_ACTIONS === 'true' && repositoryName ? `/${repositoryName}` : '/';

export default defineConfig({
  output: 'static',
  site: process.env.PUBLIC_SITE_URL ?? 'http://localhost:4321',
  base: process.env.PUBLIC_BASE_PATH ?? inferredBase,
});
