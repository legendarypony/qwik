/* eslint-disable no-console */
import type { AppCommand } from '../utils/app-command';
import { loadIntegrations, sortIntegrationsAndReturnAsClackOptions } from '../utils/integrations';
import { bgBlue, bold, magenta, cyan, bgMagenta } from 'kleur/colors';
import { bye, getPackageManager, panic, printHeader, note } from '../utils/utils';
import { updateApp } from './update-app';
import type { IntegrationData, UpdateAppResult } from '../types';
import { relative } from 'node:path';
import { logNextStep } from '../utils/log';
import { runInPkg } from '../utils/install-deps';
import { intro, isCancel, select, log, spinner, outro } from '@clack/prompts';

export async function runAddInteractive(app: AppCommand, id: string | undefined) {
  const pkgManager = getPackageManager();
  const integrations = await loadIntegrations();
  let integration: IntegrationData | undefined;

  console.clear();
  printHeader();

  if (typeof id === 'string') {
    // cli passed a flag with the integration id to add
    integration = integrations.find((i) => i.id === id);
    if (!integration) {
      throw new Error(`Invalid integration: ${id}`);
    }

    intro(`🦋 ${bgBlue(` Add Integration `)} ${bold(magenta(integration.id))}`);
  } else {
    // use interactive cli to choose which integration to add
    intro(`🦋 ${bgBlue(` Add Integration `)}`);

    const integrationChoices = [
      ...integrations.filter((i) => i.type === 'adapter'),
      ...integrations.filter((i) => i.type === 'feature'),
    ];

    const integrationAnswer = await select({
      message: 'What integration would you like to add?',
      options: await sortIntegrationsAndReturnAsClackOptions(integrationChoices),
    });

    if (isCancel(integrationAnswer)) {
      bye();
    }

    integration = integrations.find((i) => i.id === integrationAnswer);

    if (!integration) {
      throw new Error(`Invalid integration: ${id}`);
    }
  }

  const integrationHasDeps =
    Object.keys({
      ...integration.pkgJson.dependencies,
      ...integration.pkgJson.devDependencies,
    }).length > 0;

  let runInstall = false;
  if (integrationHasDeps) {
    runInstall = true;
  }

  const result = await updateApp(pkgManager, {
    rootDir: app.rootDir,
    integration: integration.id,
    installDeps: runInstall,
  });

  await logUpdateAppResult(pkgManager, result);
  await result.commit(true);
  const postInstall = result.integration.pkgJson.__qwik__?.postInstall;
  if (postInstall) {
    const s = spinner();
    s.start(`Running post install script: ${postInstall}`);
    await runInPkg(pkgManager, postInstall.split(' '), app.rootDir);
    s.stop('Post install script complete');
  }
  logUpdateAppCommitResult(result);

  // close the process
  process.exit(0);
}

async function logUpdateAppResult(pkgManager: string, result: UpdateAppResult) {
  const modifyFiles = result.updates.files.filter((f) => f.type === 'modify');
  const overwriteFiles = result.updates.files.filter((f) => f.type === 'overwrite');
  const createFiles = result.updates.files.filter((f) => f.type === 'create');
  const installDepNames = Object.keys(result.updates.installedDeps);
  const installDeps = installDepNames.length > 0;

  if (
    modifyFiles.length === 0 &&
    overwriteFiles.length === 0 &&
    createFiles.length === 0 &&
    !installDeps
  ) {
    panic(`No updates made`);
  }

  log.step(`👻 ${bgBlue(` Ready? `)} Add ${bold(magenta(result.integration.id))} to your app?`);

  if (modifyFiles.length > 0) {
    log.message(
      [
        `🐬 ${cyan('Modify')}`,
        ...modifyFiles.map((f) => `   - ${relative(process.cwd(), f.path)}`),
      ].join('\n')
    );
  }

  if (createFiles.length > 0) {
    log.message(
      [
        `🌟 ${cyan(`Create`)}`,
        ...createFiles.map((f) => `   - ${relative(process.cwd(), f.path)}`),
      ].join('\n')
    );
  }

  if (overwriteFiles.length > 0) {
    log.message(
      [
        `🐳 ${cyan(`Overwrite`)}`,
        ...overwriteFiles.map((f) => `   - ${relative(process.cwd(), f.path)}`),
      ].join('\n')
    );
  }

  if (installDepNames) {
    log.message(
      [
        `💾 ${cyan(`Install ${pkgManager} dependenc${installDepNames.length > 1 ? 'ies' : 'y'}:`)}`,
        ...installDepNames.map(
          (depName) => `   - ${depName} ${result.updates.installedDeps[depName]}`
        ),
      ].join('\n')
    );
  }

  const commit = await select({
    message: `Ready to apply the ${bold(magenta(result.integration.id))} updates to your app?`,
    options: [
      { label: 'Yes looks good, finish update!', value: true },
      { label: 'Nope, cancel update', value: false },
    ],
  });

  if (isCancel(commit) || !commit) {
    bye();
  }
}

function logUpdateAppCommitResult(result: UpdateAppResult) {
  const nextSteps = result.integration.pkgJson.__qwik__?.nextSteps;
  if (nextSteps) {
    note(logNextStep(nextSteps), 'Note');
  }

  outro(`🦄 ${bgMagenta(` Success! `)} Added ${bold(cyan(result.integration.id))} to your app`);

  // TODO: `logSuccessFooter` returns a string, but we don't use it!
  // logSuccessFooter(result.integration.docs);
}
