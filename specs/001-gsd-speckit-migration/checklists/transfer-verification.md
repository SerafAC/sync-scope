# Transfer Verification Checklist (removal gate)

**Contract**: [contracts/transfer-verification.md](../contracts/transfer-verification.md)

GSD removal (User Story 4) MUST NOT start until every item is `[X]`. Each item names the check that proves
it.

## Items

- [X] **GSD runtime detached**: `pgrep -af 'gsd-pi|gsd-browser'` shows no process for this project, and
      `.claude/settings.local.json` enables no GSD MCP server. Done right after the freeze commit.
- [X] **Consolidated**: `git branch --merged master` lists `milestone/M001`, `git log master..milestone/M001`
      is empty, and `git status --porcelain` is empty.
- [ ] **No stray work**: `git worktree list` shows only the main worktree, and `.gsd-worktrees/` is empty.
- [X] **Gates green on the staged merge, before the merge commit**: `pnpm lint`, `pnpm typecheck`,
      `pnpm test:ci`, `pnpm test:android:unit`, and the S01 live gate
      (`pnpm validation:services:start && pnpm validation:services:health && pnpm validation:android:api31 && pnpm validation:services:stop`)
      all exit 0. Record the output tails and the live-gate test count.
- [X] **Docs in the merge commit**: `git show --stat <merge-sha>` includes `CHANGELOG.md`, `docs/README.md`
      and `docs/architecture.md`.
- [ ] **Map complete**: every inventory item in [migration-map.md](../contracts/migration-map.md) has a row, and every
      row is `Verified [X]`.
- [ ] **Requirements traced**: all 30 R-IDs resolve (`git grep -w R0NN` finds each one in `specs/` or
      `docs/scope.md`). Each active R-ID has exactly one primary FR, and that FR states its class.
- [ ] **Decisions traced**: 15 files `docs/decisions/0001-*.md` to `0015-*.md` exist and are listed in the
      index.
- [ ] **Memories reviewed**: every MEM row in `gsd-export.md` has a disposition in the map.
- [ ] **S01 captured**: `specs/002-*/tasks.md` shows T001–T008 `[X]`, with commit refs and both pieces of
      gate evidence. `specs/002-*/spec.md` marks R001–R004 and R018 validated.
- [ ] **S02–S07 seeded**: `specs/003-*` to `specs/008-*` each have a `spec.md` with status `Draft (seeded)`,
      and `.specify/feature.json` points at `specs/003-local-source-selection`.
- [ ] **Docs baseline**: `README.md`, `DEVELOPMENT.md`, `CHANGELOG.md` and `docs/README.md` exist.
      `CHANGELOG.md` has an `Unreleased` migration entry.
- [ ] **Neutral wording**: the post-removal search below, run now with `':!.gsd' ':!.gitignore' ':!.mcp.json' ':!.bg-shell'`
      added to its exclusions, already returns nothing.

## Post-removal checks (recorded after the removal commit)

- [ ] `git grep -nIwi -e gsd -e 'get-shit-done' -- . ':!specs/001-gsd-speckit-migration' ':!CHANGELOG.md'`
      returns nothing (SC-003).
- [ ] The same gate commands as above, including the S01 live gate, return the same results (SC-004).
- [ ] The removal is exactly one commit; its hash is recorded in the migration-map footer (SC-006).
- [ ] `git branch --list milestone/M001` is empty.
- [ ] Fresh-session check (SC-002): a new agent session asked "what is next?" reaches
      `specs/003-local-source-selection/spec.md` and its acceptance scenarios in under 5 minutes, using only
      Spec Kit artifacts. Record the elapsed time.

## Baseline (2026-09-28)

Recorded on `master` at `1fc1130` (re-planned baseline, see `../decisions.md`). Commit
`e79e0f6` counts as the Spec Kit adoption commit. The working tree holds only the Phase 1 follow-up edits
(T002, T003 and this file).

### `git status --porcelain`

```text
 M .specify/memory/constitution.md
 M specs/001-gsd-speckit-migration/checklists/requirements.md
?? specs/001-gsd-speckit-migration/checklists/transfer-verification.md
```

### `git worktree list`

```text
/home/adi/projects/sync-scope 1fc1130 [master]
```

### `git log --oneline master..milestone/M001` (expect 13 commits)

```text
16d75ac fix: resolve the Android SDK path instead of dereferencing an unset ANDROID_HOME
38f0dcf chore: auto-commit after stop
c04b121 chore: auto-commit after stop
a402a66 chore: auto-commit after stop
8e38f68 chore: auto-commit after stop
f331aad feat: Validation scripts now derive the repo root from their own loca...
bb37998 feat: Added Keystore-backed CredentialStore (EncryptedSharedPreferenc...
a01bb64 feat: Added the read-only OkHttp WebDavRemoteClient (OPTIONS + PROPFI...
3001c5d feat: Added the SSHJ-backed read-only SftpRemoteClient with blocking...
9500a9c feat: Added the read-only RemoteClient contract (no content-read surf...
ca9dd60 feat: Registered the CloudSync TurboModule (codegen NativeCloudSyncSp...
ab3d95c chore: auto-commit after stop
7c4d394 chore: auto-commit after stop
(13 commits)
```

### `git merge-tree --write-tree --name-only master milestone/M001` (expect exit 1, 17 conflicts)

15 add/add conflicts under `.gsd/**` and 2 content conflicts in `scripts/validation/`, as expected by the
re-plan. T011 resolves the two `scripts/validation/` conflicts to `milestone/M001`'s side.

```text
1e82b16866ff9f71165a1f8c30482ceeea5265d9
.gsd/.compat.json
.gsd/DECISIONS.md
.gsd/last-snapshot.md
.gsd/phases/01-syncscope-v1/01-01-PLAN.md
.gsd/phases/01-syncscope-v1/01-01-RESEARCH.md
.gsd/phases/01-syncscope-v1/01-CONTEXT.md
.gsd/phases/01-syncscope-v1/01-ROADMAP.md
.gsd/phases/01-syncscope-v1/S01-CONTINUE.md
.gsd/phases/01-syncscope-v1/S01-T01-SUMMARY.md
.gsd/phases/01-syncscope-v1/S01-T02-SUMMARY.md
.gsd/phases/01-syncscope-v1/S01-T03-SUMMARY.md
.gsd/phases/01-syncscope-v1/S01-T04-SUMMARY.md
.gsd/phases/01-syncscope-v1/S01-T05-SUMMARY.md
.gsd/phases/01-syncscope-v1/S01-T06-SUMMARY.md
.gsd/phases/01-syncscope-v1/S01-T07-SUMMARY.md
scripts/validation/protocol-service.sh
scripts/validation/validation-infrastructure.test.mjs

Auto-merging .gsd/.compat.json
CONFLICT (add/add): Merge conflict in .gsd/.compat.json
Auto-merging .gsd/DECISIONS.md
CONFLICT (add/add): Merge conflict in .gsd/DECISIONS.md
Auto-merging .gsd/last-snapshot.md
CONFLICT (add/add): Merge conflict in .gsd/last-snapshot.md
Auto-merging .gsd/phases/01-syncscope-v1/01-01-PLAN.md
CONFLICT (add/add): Merge conflict in .gsd/phases/01-syncscope-v1/01-01-PLAN.md
Auto-merging .gsd/phases/01-syncscope-v1/01-01-RESEARCH.md
CONFLICT (add/add): Merge conflict in .gsd/phases/01-syncscope-v1/01-01-RESEARCH.md
Auto-merging .gsd/phases/01-syncscope-v1/01-CONTEXT.md
CONFLICT (add/add): Merge conflict in .gsd/phases/01-syncscope-v1/01-CONTEXT.md
Auto-merging .gsd/phases/01-syncscope-v1/01-ROADMAP.md
CONFLICT (add/add): Merge conflict in .gsd/phases/01-syncscope-v1/01-ROADMAP.md
Auto-merging .gsd/phases/01-syncscope-v1/S01-CONTINUE.md
CONFLICT (add/add): Merge conflict in .gsd/phases/01-syncscope-v1/S01-CONTINUE.md
Auto-merging .gsd/phases/01-syncscope-v1/S01-T01-SUMMARY.md
CONFLICT (add/add): Merge conflict in .gsd/phases/01-syncscope-v1/S01-T01-SUMMARY.md
Auto-merging .gsd/phases/01-syncscope-v1/S01-T02-SUMMARY.md
CONFLICT (add/add): Merge conflict in .gsd/phases/01-syncscope-v1/S01-T02-SUMMARY.md
Auto-merging .gsd/phases/01-syncscope-v1/S01-T03-SUMMARY.md
CONFLICT (add/add): Merge conflict in .gsd/phases/01-syncscope-v1/S01-T03-SUMMARY.md
Auto-merging .gsd/phases/01-syncscope-v1/S01-T04-SUMMARY.md
CONFLICT (add/add): Merge conflict in .gsd/phases/01-syncscope-v1/S01-T04-SUMMARY.md
Auto-merging .gsd/phases/01-syncscope-v1/S01-T05-SUMMARY.md
CONFLICT (add/add): Merge conflict in .gsd/phases/01-syncscope-v1/S01-T05-SUMMARY.md
Auto-merging .gsd/phases/01-syncscope-v1/S01-T06-SUMMARY.md
CONFLICT (add/add): Merge conflict in .gsd/phases/01-syncscope-v1/S01-T06-SUMMARY.md
Auto-merging .gsd/phases/01-syncscope-v1/S01-T07-SUMMARY.md
CONFLICT (add/add): Merge conflict in .gsd/phases/01-syncscope-v1/S01-T07-SUMMARY.md
Auto-merging scripts/validation/protocol-service.sh
CONFLICT (content): Merge conflict in scripts/validation/protocol-service.sh
Auto-merging scripts/validation/validation-infrastructure.test.mjs
CONFLICT (content): Merge conflict in scripts/validation/validation-infrastructure.test.mjs
(exit 1)
```

## Master duplicate of D015 (T005, re-planned 2026-09-28)

Master's duplicate D015 script edits were committed in `769182d`, so `git restore` no longer applies and
`scripts/` is not touched here. T011 resolves both files below to `milestone/M001`'s side, which carries the
authoritative D015 implementation and its tests (research R2).

### `git diff master milestone/M001 -- scripts/validation/protocol-service.sh scripts/validation/validation-infrastructure.test.mjs`

Recorded on `master` at `33f8167`.

```diff
diff --git a/scripts/validation/protocol-service.sh b/scripts/validation/protocol-service.sh
index ed593ad..8a01746 100755
--- a/scripts/validation/protocol-service.sh
+++ b/scripts/validation/protocol-service.sh
@@ -29,7 +29,7 @@ esac
 case "$project" in syncscope-sftp|syncscope-webdav|syncscope-ftp) ;; *) exit 64 ;; esac
 [ -f "$compose" ] || exit 1
 
-repo=/home/adi/projects/cloud-sync-checker
+repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
 state="/tmp/cloud-sync-checker-$project"
 credentials="$state/credentials"
 owner="$state/owner"
@@ -61,9 +61,10 @@ healthcheck() {
 case "$action" in
   start)
     docker_version=$(docker version --format '{{.Client.Version}} {{.Server.Version}}')
+    # Any Docker 29 patch/minor release is accepted; a new major needs a deliberate bump.
     case "$docker_version" in
-      29.*" "29.*) ;;
-      *) printf '%s\n' "Docker 29.x client and server are required." >&2; exit 1 ;;
+      "29."*" 29."*) ;;
+      *) printf '%s\n' "Docker 29.x is required." >&2; exit 1 ;;
     esac
     [ "$(docker compose version --short)" = "5.5.1" ] ||
       { printf '%s\n' "Compose 5.5.1 is required." >&2; exit 1; }
@@ -129,6 +130,19 @@ case "$action" in
     healthcheck
     ;;
   stop)
+    if [ ! -e "$state" ]; then
+      # Nothing of ours is left: android-flow.sh stops the services it started and removes
+      # their state, so the gate's trailing `validation:services:stop` finds a clean host.
+      # A guard against tearing down someone else's project must not turn an
+      # already-clean environment into a failure, but a project still running without our
+      # state really is unowned and is still refused.
+      if compose_command ps --status running --services 2>/dev/null |
+        grep -qx "$protocol"; then
+        printf '%s\n' "Refusing to stop an unowned Compose project." >&2
+        exit 1
+      fi
+      exit 0
+    fi
     [ -f "$owner" ] && [ "$(cat "$owner")" = "$project:$protocol" ] || {
       printf '%s\n' "Refusing to stop an unowned Compose project." >&2
       exit 1
diff --git a/scripts/validation/validation-infrastructure.test.mjs b/scripts/validation/validation-infrastructure.test.mjs
index d343751..73f2f9f 100644
--- a/scripts/validation/validation-infrastructure.test.mjs
+++ b/scripts/validation/validation-infrastructure.test.mjs
@@ -2,14 +2,15 @@ import assert from 'node:assert/strict';
 import {
   chmod,
   lstat,
+  mkdir,
   mkdtemp,
   readFile,
   rm,
   writeFile,
 } from 'node:fs/promises';
-import { spawnSync } from 'node:child_process';
-import { tmpdir } from 'node:os';
-import { join } from 'node:path';
+import {spawnSync} from 'node:child_process';
+import {tmpdir} from 'node:os';
+import {dirname, join} from 'node:path';
 import test from 'node:test';
 
 const root = new URL('../../', import.meta.url);
@@ -20,7 +21,9 @@ async function text(path) {
 
 test('pins loopback-only read-only protocol services', async () => {
   const compose = await text('validation/services/compose.yaml');
-  const entrypoint = await text('validation/services/runtime-entrypoint.sh');
+  const entrypoint = await text(
+    'validation/services/runtime-entrypoint.sh',
+  );
 
   for (const digest of [
     'cloud-sync-checker/sftp-validation@sha256:04907991d1417618fbe8dadc349e5db305cc19a7af66cb4c7198c7be769e31ac',
@@ -52,8 +55,8 @@ test('generates deterministic representative fixture metadata', async t => {
   const secondState = await mkdtemp(
     join(tmpdir(), 'cloud-sync-checker-fixture-test-'),
   );
-  t.after(() => rm(state, { recursive: true, force: true }));
-  t.after(() => rm(secondState, { recursive: true, force: true }));
+  t.after(() => rm(state, {recursive: true, force: true}));
+  t.after(() => rm(secondState, {recursive: true, force: true}));
 
   const seed = spawnSync(
     'sh',
@@ -62,7 +65,7 @@ test('generates deterministic representative fixture metadata', async t => {
       '--root',
       join(state, 'fixtures'),
     ],
-    { encoding: 'utf8' },
+    {encoding: 'utf8'},
   );
   assert.equal(seed.status, 0, seed.stderr);
 
@@ -93,7 +96,7 @@ test('generates deterministic representative fixture metadata', async t => {
       '--state',
       state,
     ],
-    { encoding: 'utf8' },
+    {encoding: 'utf8'},
   );
   assert.equal(first.status, 0, first.stderr);
   const secondSeed = spawnSync(
@@ -103,7 +106,7 @@ test('generates deterministic representative fixture metadata', async t => {
       '--root',
       join(secondState, 'fixtures'),
     ],
-    { encoding: 'utf8' },
+    {encoding: 'utf8'},
   );
   assert.equal(secondSeed.status, 0, secondSeed.stderr);
   const independent = spawnSync(
@@ -117,12 +120,15 @@ test('generates deterministic representative fixture metadata', async t => {
       '--state',
       secondState,
     ],
-    { encoding: 'utf8' },
+    {encoding: 'utf8'},
   );
   assert.equal(independent.status, 0, independent.stderr);
   assert.equal(
     await readFile(join(state, 'manifests/sftp.before.sha256'), 'utf8'),
-    await readFile(join(secondState, 'manifests/sftp.before.sha256'), 'utf8'),
+    await readFile(
+      join(secondState, 'manifests/sftp.before.sha256'),
+      'utf8',
+    ),
   );
   const second = spawnSync(
     'sh',
@@ -135,7 +141,7 @@ test('generates deterministic representative fixture metadata', async t => {
       '--state',
       state,
     ],
-    { encoding: 'utf8' },
+    {encoding: 'utf8'},
   );
   assert.equal(second.status, 0, second.stderr);
   assert.match(second.stdout, /zero unexpected remote changes/);
@@ -174,11 +180,11 @@ test('exposes bounded owned service and serial validator entry points', async ()
   );
 });
 
-async function launchWithDockerVersion(t, dockerVersion) {
+async function launchWithStubbedDocker(t, dockerVersion) {
   const bin = await mkdtemp(
     join(tmpdir(), 'cloud-sync-checker-launcher-test-'),
   );
-  t.after(() => rm(bin, { recursive: true, force: true }));
+  t.after(() => rm(bin, {recursive: true, force: true}));
 
   const docker = join(bin, 'docker');
   await writeFile(
@@ -224,34 +230,114 @@ esac
     ],
     {
       encoding: 'utf8',
-      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
+      env: {...process.env, PATH: `${bin}:${process.env.PATH}`},
     },
   );
 }
 
-for (const dockerVersion of ['29.7.2 29.7.2', '29.8.1 29.0.0']) {
-  test(`protocol launcher accepts Docker ${dockerVersion} before preflight`, async t => {
-    const launch = await launchWithDockerVersion(t, dockerVersion);
-
-    assert.equal(launch.status, 1);
-    assert.match(launch.stderr, /Approved service port is occupied/);
-    assert.doesNotMatch(
-      launch.stderr,
-      /Docker 29\.x client and server are required|Compose 5\.5\.1 is required|unexpected/,
-    );
-  });
+test('protocol launcher accepts any Docker 29 release before preflight', async t => {
+  const launch = await launchWithStubbedDocker(t, '29.8.1 29.8.1');
+
+  assert.equal(launch.status, 1);
+  assert.match(launch.stderr, /Approved service port is occupied/);
+  assert.doesNotMatch(
+    launch.stderr,
+    /Docker 29\.x is required|Compose 5\.5\.1 is required|unexpected/,
+  );
+});
+
+test('protocol launcher rejects a Docker major other than 29', async t => {
+  for (const version of ['30.0.0 30.0.0', '29.8.1 30.0.0', '28.5.2 29.8.1']) {
+    const launch = await launchWithStubbedDocker(t, version);
+
+    assert.equal(launch.status, 1, version);
+    assert.match(launch.stderr, /Docker 29\.x is required/, version);
+    assert.doesNotMatch(launch.stderr, /Approved service port/, version);
+  }
+});
+
+async function fakeSdk(t) {
+  const home = await mkdtemp(join(tmpdir(), 'cloud-sync-checker-sdk-test-'));
+  t.after(() => rm(home, {recursive: true, force: true}));
+
+  const sdk = join(home, 'Android', 'Sdk');
+  for (const component of ['platform-tools/adb', 'emulator/emulator']) {
+    const binary = join(sdk, component);
+    await mkdir(dirname(binary), {recursive: true});
+    await writeFile(binary, '#!/bin/sh\nexit 0\n');
+    await chmod(binary, 0o755);
+  }
+
+  return {home, sdk};
 }
 
-for (const dockerVersion of [
-  '30.0.0 30.0.0',
-  '28.5.1 29.8.1',
-  '29.8.1 28.5.1',
-]) {
-  test(`protocol launcher rejects Docker ${dockerVersion}`, async t => {
-    const launch = await launchWithDockerVersion(t, dockerVersion);
-
-    assert.equal(launch.status, 1);
-    assert.match(launch.stderr, /Docker 29\.x client and server are required/);
-    assert.doesNotMatch(launch.stderr, /Approved service port is occupied/);
-  });
+function resolveSdk(env) {
+  const helper = new URL('android-sdk.sh', import.meta.url).pathname;
+
+  return spawnSync(
+    'sh',
+    ['-c', `. "${helper}"; android_sdk_resolve; printf '%s\\n' "$ANDROID_HOME"`],
+    {encoding: 'utf8', env},
+  );
 }
+
+test('resolves the Android SDK without an exported ANDROID_HOME', async t => {
+  const {home, sdk} = await fakeSdk(t);
+  const env = {...process.env, HOME: home};
+  delete env.ANDROID_HOME;
+  delete env.ANDROID_SDK_ROOT;
+
+  const resolved = resolveSdk(env);
+
+  assert.equal(resolved.status, 0, resolved.stderr);
+  assert.equal(resolved.stdout.trim(), sdk);
+});
+
+test('prefers an explicit ANDROID_HOME over ANDROID_SDK_ROOT and the default', async t => {
+  const {home, sdk} = await fakeSdk(t);
+
+  assert.equal(
+    resolveSdk({
+      ...process.env,
+      HOME: '/nonexistent',
+      ANDROID_HOME: sdk,
+      ANDROID_SDK_ROOT: '/nonexistent/sdk',
+    }).stdout.trim(),
+    sdk,
+  );
+  assert.equal(
+    resolveSdk({
+      ...process.env,
+      HOME: home,
+      ANDROID_HOME: '',
+      ANDROID_SDK_ROOT: sdk,
+    }).stdout.trim(),
+    sdk,
+  );
+});
+
+test('names the missing Android SDK instead of aborting on an unbound variable', async () => {
+  const env = {...process.env, HOME: '/nonexistent', ANDROID_HOME: '/nonexistent/sdk'};
+  delete env.ANDROID_SDK_ROOT;
+
+  const resolved = resolveSdk(env);
+
+  assert.equal(resolved.status, 1);
+  assert.match(resolved.stderr, /Android SDK not usable at '\/nonexistent\/sdk'/);
+  assert.match(resolved.stderr, /Set ANDROID_HOME/);
+  assert.doesNotMatch(resolved.stderr, /unbound variable/);
+});
+
+test('resolves the SDK before any script dereferences ANDROID_HOME', async () => {
+  for (const script of [
+    'scripts/validation/android-validator.sh',
+    'scripts/validation/android-flow.sh',
+  ]) {
+    const source = await text(script);
+    const resolved = source.indexOf('android_sdk_resolve');
+    const used = source.indexOf('$ANDROID_HOME/');
+
+    assert.ok(resolved !== -1, `${script} must resolve the SDK`);
+    assert.ok(used === -1 || resolved < used, `${script} dereferences ANDROID_HOME too early`);
+  }
+});
```

## US1 consolidation evidence (2026-09-28)

### T011 conflict resolution

`git merge --no-ff --no-commit milestone/M001` stopped with the 17 expected conflicts. `.gsd/DECISIONS.md`
was resolved to master's side (ours). The other 14 `.gsd/**` paths and both `scripts/validation/` files
(`protocol-service.sh`, `validation-infrastructure.test.mjs`) were resolved to milestone/M001's side
(theirs). `git diff --cached --quiet <side> -- <path>` confirmed that each staged file matches its winning
side. No conflict fell outside the expected set. Each resolution has a `tooling` row in `../migration-map.md`.

### T014 nothing lost (SC-005), staged merge vs branch

`git diff milestone/M001 -- . ':!.gsd' ':!specs' ':!.specify' ':!.claude' ':!CHANGELOG.md' ':!docs'`:

```text
$ git diff --name-status milestone/M001 -- . ':!.gsd' ':!specs' ':!.specify' ':!.claude' ':!CHANGELOG.md' ':!docs'
A	project-definition.md
```

The only difference is `project-definition.md`, which was **added** on master in e79e0f6 and never existed
on milestone/M001. It is the original brief, which the spec keeps as the historical brief (spec.md,
Assumptions). The task's pathspec did not exclude it. No file from the branch is missing or modified. With
`':!project-definition.md'` added to the pathspec, the diff is empty (`git diff --quiet` exit 0). So no
branch content was lost. The second SC-005 check (`git log --oneline master..milestone/M001`) is recorded
after the merge commit (T016).

### T015 gates on the staged, uncommitted merge

All gates were run with the merge staged (`MERGE_HEAD` = milestone/M001) and not committed.
`ANDROID_HOME=$HOME/Android/Sdk` was exported for the Android gates (environment only, per MEM015).

| Command | Exit | Output tail |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 0 | `Already up to date` / `Done in 493ms using pnpm v11.3.0` |
| `pnpm lint` | 0 | `eslint . --max-warnings=0`, no findings |
| `pnpm typecheck` | 0 | `tsc --noEmit`, no findings |
| `pnpm test:ci` | 0 | foundation `node --test`: tests 10, pass 10, fail 0; Jest: `Test Suites: 4 passed, 4 total`, `Tests: 17 passed, 17 total` |
| `pnpm test:android:unit` | 0 | `BUILD SUCCESSFUL in 2m 7s`; JUnit XML: 15 suites, 120 tests, 0 failures, 0 errors, 0 skipped |
| S01 live gate (first attempt) | 1 | `Validator memory preflight failed.` The environment failed, not the code (see below). |
| S01 live gate (rerun) | 0 | see below |

**Live-gate environment fix.** On the first attempt, `android-validator.sh` `memory_ready` refused to
start the emulator. It requires MemAvailable >= 8 GiB and >= 30% of MemTotal, and only about 5.7 GiB was
available, because the Gradle and Kotlin daemons left over from `pnpm test:android:unit` held about 4 GB. The
fix stopped those daemons (`./gradlew --stop`, then the two Kotlin compile daemons), which raised
MemAvailable to 31% of total. No code was changed. The protocol services were started, audited clean and
stopped normally during the failed attempt.

**Live gate rerun**
(`pnpm validation:services:start && pnpm validation:services:health && pnpm validation:android:api31 && pnpm validation:services:stop`),
exit 0:

```text
Starting 8 tests on dependency_api31(AVD) - 12
dependency_api31(AVD) - 12 Tests 3/8 completed. (0 skipped) (0 failed)
dependency_api31(AVD) - 12 Tests 4/8 completed. (0 skipped) (0 failed)
Finished 8 tests on dependency_api31(AVD) - 12
ftp audit: metadata-read operation allowlist is clean
ftp: zero unexpected remote changes
webdav audit: metadata-read operation allowlist is clean
webdav: zero unexpected remote changes
sftp audit: metadata-read operation allowlist is clean
sftp: zero unexpected remote changes
LIVE_EXIT=0
```

8/8 instrumented tests and three clean protocol audits. Afterwards no emulator was attached to adb, and
`/tmp/cloud-sync-checker-api31` was gone.

**Merge commit** `82188c4` (parents `f64bcce` master, `16d75ac` milestone/M001):

- `git branch --merged master` lists `milestone/M001`, and `git log --oneline master..milestone/M001` is empty.
- `git show --stat 82188c4` lists `CHANGELOG.md` (+16), `docs/README.md` (+3) and `docs/architecture.md` (+53).
