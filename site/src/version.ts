// Which build of the site this is: the commit it was built from, set at build time in
// vite.config.ts, so a visitor (or the owner) can tell which version is running.
declare const __VERSION__: { sha: string; branch: string; built: string } | undefined;

export const REPO = 'https://github.com/RoshBeed/showtimes';
export const VERSION = typeof __VERSION__ === 'undefined' ? { sha: '', branch: '', built: '' } : __VERSION__;

/** The version as shown: the short commit, with the branch when it is not production's. */
export function versionLabel(version = VERSION): string {
  if (!version.sha) return 'local build';
  const short = version.sha.slice(0, 7);
  return version.branch && version.branch !== 'main' ? `${version.branch} ${short}` : short;
}

/** Where the version's commit is on GitHub, or the repository when the commit is not known. */
export const versionHref = (version = VERSION): string => (version.sha ? `${REPO}/commit/${version.sha}` : REPO);
