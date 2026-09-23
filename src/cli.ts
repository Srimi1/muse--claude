#!/usr/bin/env node
import { Command, Option } from 'commander';
import { setupCommand } from './commands/setup.js';
import { modelsCommand } from './commands/models.js';
import { doctorCommand } from './commands/doctor.js';
import { launchCommand } from './commands/launch.js';
import { startBroker } from './broker/server.js';
import { MAX_EXCHANGE_MESSAGES } from './config/constants.js';
import { brokerRequest, resolveTalkHarness } from './cli/request.js';
import { shouldDefaultToLaunch } from './cli-args.js';

/**
 * `--subscription` flag shared by commands that also take `--muse`;
 * the two pick different credential sources, so they are exclusive.
 */
function subscriptionOption(): Option {
  return new Option('--subscription', 'Use the Muse Code subscription instead of an API key for this run').conflicts(
    'muse'
  );
}

/**
 * Main CLI entry point.
 */
export function runCli() {
  const program = new Command();

  program
    .name('claude-muse')
    .description('Launch Claude Code with Muse Spark models via Meta Model API')
    .version('0.1.0');

  program
    .command('setup')
    .description('Setup Muse Code subscription or Meta Model API credentials')
    .action(setupCommand);

  program
    .command('models')
    .description('List available models')
    .option('--select', 'Select a model interactively')
    .option('--muse', 'Use the API key stored in Muse for this run')
    .addOption(subscriptionOption())
    .action(modelsCommand);

  program
    .command('doctor')
    .description('Check system configuration and API connectivity')
    .option('--subscription', 'Check the Muse Code subscription login for this run')
    .action(doctorCommand);

  program
    .command('launch')
    .description('Launch Claude Code with Muse Spark (default)')
    .option('--model <id>', 'Specify model to use')
    .option('--muse', 'Use the API key stored in Muse for this run')
    .addOption(subscriptionOption())
    .action(launchCommand);

  // ── Talk subcommand group ──
  const talk = program
    .command('talk')
    .description('Cross-terminal exchange bridge');

  talk
    .command('broker')
    .description('Start the /talk broker server')
    .action(async () => {
      console.log('Starting /talk broker...');
      await startBroker();
      // Broker runs until SIGINT/SIGTERM
    });

  talk
    .command('join')
    .argument('<room>', 'Room name')
    .argument('<name>', 'Your display name')
    .option('--harness <harness>', "Which CLI you are joining from: 'claude' or 'muse' (default: $TALK_HARNESS or 'claude')")
    .description('Join a talk room')
    .action(async (room: string, name: string, options: { harness?: string }) => {
      try {
        const result = await brokerRequest('join', { room, name, harness: resolveTalkHarness(options.harness) });
        if (result.waitingForPeer) {
          console.log(`Joined room '${room}' as '${name}'. Waiting for peer...`);
        } else {
          console.log(`Joined room '${room}' as '${name}'. ${result.participantCount} participants ready.`);
        }
      } catch (err: any) {
        console.error(err.message);
        process.exit(1);
      }
    });

  talk
    .command('start')
    .argument('<room>', 'Room name')
    .argument('<task>', 'Task description')
    .description('Start an exchange in a room')
    .action(async (room: string, task: string) => {
      try {
        const result = await brokerRequest('start', { room, task });
        console.log(`Exchange started in '${room}'. Stage: ${result.stage}`);
      } catch (err: any) {
        console.error(err.message);
        process.exit(1);
      }
    });

  talk
    .command('status')
    .argument('<room>', 'Room name')
    .description('Check room status')
    .action(async (room: string) => {
      try {
        const status = await brokerRequest('status', { room });
        const r = status.room;
        console.log(`Room: ${r.id}`);
        console.log(`State: ${r.state}`);
        console.log(`Stage: ${r.currentStage ?? 'N/A'}`);
        console.log(`Messages: ${r.messageCount}/${MAX_EXCHANGE_MESSAGES}`);
        console.log(`Participants:`);
        for (const p of r.participants) {
          const conn = p.connected ? '●' : '○';
          console.log(`  ${conn} ${p.name} (${p.harness})`);
        }
      } catch (err: any) {
        console.error(err.message);
        process.exit(1);
      }
    });

  talk
    .command('stop')
    .argument('<room>', 'Room name')
    .description('Stop an exchange')
    .action(async (room: string) => {
      try {
        await brokerRequest('stop', { room });
        console.log(`Exchange in '${room}' stopped.`);
      } catch (err: any) {
        console.error(err.message);
        process.exit(1);
      }
    });

  talk
    .command('transcript')
    .argument('<room>', 'Room name')
    .description('Show exchange transcript')
    .action(async (room: string) => {
      try {
        const result = await brokerRequest('transcript', { room });
        if (!result.entries || result.entries.length === 0) {
          console.log('No messages yet.');
          return;
        }
        for (const entry of result.entries) {
          console.log(`\n--- [${entry.stage}] ${entry.senderName} (${entry.harness}) ---`);
          console.log(entry.content);
        }
        if (result.summary) {
          console.log('\n=== SUMMARY ===');
          console.log(JSON.stringify(result.summary, null, 2));
        }
      } catch (err: any) {
        console.error(err.message);
        process.exit(1);
      }
    });

  // `claude-muse` and `claude-muse --model x` mean `claude-muse launch [...]`.
  // Anything else is left alone so commander can report an unknown command
  // rather than forwarding it to launch as a stray positional argument.
  if (shouldDefaultToLaunch(process.argv.slice(2))) {
    process.argv.splice(2, 0, 'launch');
  }

  program.parse(process.argv);
}

// Run CLI
runCli();
