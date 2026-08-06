const GITHUB_RELEASE_PATTERN =
  /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/([^/?#]+)$/u;

const RAW_GITHUB_MODULE_BASE =
  'https://raw.githubusercontent.com/T-Damer/MiniMed/main/apps/app/public/content/modules';

function resolveRelativeModulePath(path: string): string {
  const normalized = path.replace(/^\./u, '');
  const base = import.meta.env.BASE_URL;
  if (typeof base !== 'string' || base.trim().length === 0) {
    throw new Error('BASE_URL is not configured for module artifact resolution.');
  }
  return new URL(normalized, new URL(base, window.location.href)).toString();
}

function localModuleArtifactUrl(fileName: string): string | null {
  if (fileName.length === 0) return null;
  try {
    return resolveRelativeModulePath(`./content/modules/${fileName}`);
  } catch {
    return null;
  }
}

function clinicalDatasetsBranchUrl(
  owner: string,
  repo: string,
  releaseTag: string,
  fileName: string,
): string {
  // Release asset hosts have no CORS. Browser installs read the datasets/* mirror branch instead.
  return `https://raw.githubusercontent.com/${owner}/${repo}/datasets/${releaseTag}/apps/app/public/content/clinical/${fileName}`;
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
    const owner = releaseMatch[1] ?? '';
    const repo = releaseMatch[2] ?? '';
    const releaseTag = releaseMatch[3] ?? '';
    const fileName = releaseMatch[4] ?? '';
    if (owner === 'T-Damer' && repo === 'MiniMed' && fileName.length > 0 && releaseTag.length > 0) {
      if (fileName.startsWith('clinical-') && fileName.endsWith('.db')) {
        if (import.meta.env.DEV && typeof window !== 'undefined') {
          return resolveRelativeModulePath(
            `./content/releases/${encodeURIComponent(releaseTag)}/${encodeURIComponent(fileName)}`,
          );
        }
        return clinicalDatasetsBranchUrl(owner, repo, releaseTag, fileName);
      }
      if (import.meta.env.DEV) {
        const localUrl = localModuleArtifactUrl(fileName);
        if (localUrl) return localUrl;
      }
      return `${RAW_GITHUB_MODULE_BASE}/${fileName}`;
    }
  }

  if (trimmed.startsWith('./') || trimmed.startsWith('../')) {
    return resolveRelativeModulePath(trimmed);
  }

  return trimmed;
}
