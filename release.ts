import releaseMetadata from './release.json';

export const RELEASE_VERSION = releaseMetadata.version;
export const RELEASE_TAG = `v${RELEASE_VERSION}`;
export const GITHUB_REPOSITORY_URL = 'https://github.com/T-Damer/MiniMed';
export const ANDROID_APK_NAME = 'MiniMed-android.apk';
export const ANDROID_APK_URL = `${GITHUB_REPOSITORY_URL}/releases/download/android-latest/${ANDROID_APK_NAME}`;
