import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

async function text(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('pins the Android-only React Native foundation', async () => {
  const packageJson = JSON.parse(await text('package.json'));
  const buildGradle = await text('android/build.gradle');
  const appBuildGradle = await text('android/app/build.gradle');
  const gradleProperties = await text('android/gradle.properties');
  const gradleWrapper = await text(
    'android/gradle/wrapper/gradle-wrapper.properties',
  );
  const gitignore = await text('.gitignore');

  assert.equal(packageJson.packageManager, 'pnpm@11.3.0');
  assert.equal(packageJson.dependencies['react-native'], '0.87.0');
  assert.equal(
    packageJson.devDependencies['@react-native/gradle-plugin'],
    '0.87.0',
  );
  assert.equal(
    packageJson.devDependencies['@react-native/codegen'],
    '0.87.0',
  );
  assert.equal(packageJson.scripts.ios, undefined);

  for (const command of [
    'typecheck',
    'lint',
    'test:ci',
    'test:android:unit',
    'test:android:connected',
  ]) {
    assert.equal(typeof packageJson.scripts[command], 'string');
  }

  assert.match(buildGradle, /minSdkVersion = 31/);
  assert.match(buildGradle, /compileSdkVersion = 37/);
  assert.match(buildGradle, /targetSdkVersion = 36/);
  assert.match(buildGradle, /buildToolsVersion = "37\.0\.0"/);
  assert.match(buildGradle, /ndkVersion = "27\.1\.12297006"/);
  assert.match(buildGradle, /cmakeVersion = "3\.22\.1"/);
  assert.match(appBuildGradle, /version rootProject\.ext\.cmakeVersion/);
  assert.match(gradleWrapper, /gradle-9\.4\.1-bin\.zip/);
  assert.match(gradleProperties, /newArchEnabled=true/);
  assert.match(gradleProperties, /hermesEnabled=true/);

  const ignoredLines = new Set(gitignore.split(/\r?\n/));
  for (const ignored of [
    'local.properties',
    '*.keystore',
    '*.jks',
    'credentials.properties',
    '*.apk',
    '.readiness/',
  ]) {
    assert.ok(ignoredLines.has(ignored), `${ignored} must be ignored`);
  }
});
