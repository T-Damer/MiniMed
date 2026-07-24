const GITHUB_RELEASE_PATTERN =
  /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/([^/?#]+)$/u;

const RAW_GITHUB_MODULE_BASE =
  'https://raw.githubusercontent.com/T-Damer/MiniMed/main/apps/app/public/content/modules';
const RAW_GITHUB_CLINICAL_PATH = 'apps/app/public/content/clinical';

function resolveRelativeModulePath(path: string): string {
  const normalized = path.replace(/^\./u, '');
  const base = import.meta.env.BASE_URL;
  if (typeof base !== 'string' || base.trim().length === 0) {
    throw new Error('BASE_URL is not configured for module artifact resolution.');
  }
  return new URL(normalized, base).toString();
}

function localModuleArtifactUrl(fileName: string): string | null {
  if (fileName.length === 0) return null;
  try {
    return resolveRelativeModulePath(`./content/modules/${fileName}`);
  } catch {
    return null;
  }
}

function rawGithubContentUrl(owner: string, repo: string, ref: string, path: string): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`;
}

export function resolveContentModuleArtifactUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed.length === 0) return trimmed;

  if (trimmed.startsWith('./content/modules/') || trimmed.startsWith('content/modules/')) {
    return resolveRelativeModulePath(trimmed);
  }

  const rawGithubModulePrefix = `${RAW_GITHUB_MODULE_BASE}/`;
  if (trimmed.startsWith(rawGithubModulePrefix) && import.meta.env.DEV) {
    const localUrl = localModuleArtifactUrl(trimmed.slice(rawGithubModulePrefix.length));
    if (localUrl) return localUrl;
  }

  const releaseMatch = GITHUB_RELEASE_PATTERN.exec(trimmed);
  if (releaseMatch) {
    const owner = releaseMatch[1];
    const repo = releaseMatch[2];
    const releaseTag = releaseMatch[3];
    const fileName = releaseMatch[4];
    if (owner === 'T-Damer' && repo === 'MiniMed' && fileName) {
      if (import.meta.env.DEV) {
        const localUrl = localModuleArtifactUrl(fileName);
        if (localUrl) return localUrl;
      }
      if (fileName.startsWith('clinical-') && fileName.endsWith('.db')) {
        return rawGithubContentUrl(owner, repo, releaseTag, `${RAW_GITHUB_CLINICAL_PATH}/${fileName}`);
      }
      return `${RAW_GITHUB_MODULE_BASE}/${fileName}`;
    }
  }

  if (trimmed.startsWith('./') || trimmed.startsWith('../')) {
    return resolveRelativeModulePath(trimmed);
  }

  return trimmed;
}
