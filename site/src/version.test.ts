import { describe, expect, it } from 'vitest';
import { REPO, versionHref, versionLabel } from './version';

const sha = 'a5acc510db47956978f0bc717c8e4eacd3690303';

describe('the version the site shows', () => {
  it('is the short commit on main, with the branch elsewhere', () => {
    expect(versionLabel({ sha, branch: 'main', built: '' })).toBe('a5acc51');
    expect(versionLabel({ sha, branch: 'dev', built: '' })).toBe('dev a5acc51');
  });
  it('links to its commit, or to the repository when the commit is not known', () => {
    expect(versionHref({ sha, branch: 'main', built: '' })).toBe(`${REPO}/commit/${sha}`);
    expect(versionLabel({ sha: '', branch: '', built: '' })).toBe('local build');
    expect(versionHref({ sha: '', branch: '', built: '' })).toBe(REPO);
  });
});
