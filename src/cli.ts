#!/usr/bin/env node
import { Command } from 'commander';
import { setupCommand } from './commands/setup.js';
import { modelsCommand } from './commands/models.js';
import { doctorCommand } from './commands/doctor.js';
import { launchCommand } from './commands/launch.js';
import { startBroker } from './broker/server.js';
import net from 'net';
import { SOCKET_PATH, MAX_EXCHANGE_MESSAGES } from './config/constants.js';
import { shouldDefaultToLaunch } from './cli-args.js';

/** How long a single CLI request waits for the broker before giving up. */
const BROKER_REQUEST_TIMEOUT_MS = 35_000;

/**
 * Sends a JSON-RPC request to the broker and returns the result.
 *
 * The promise always settles: a broker that accepts the connection and then
 * goes away, or never answers, produces an error instead of hanging the CLI.
 */
async function brokerRequest(method: string, params: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (err: Error | null, result?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve(result);
    };

    const socket = net.createConnection(SOCKET_PATH, () => {
      const request = { jsonrpc: '2.0', id: 1, method, params };
      socket.write(JSON.stringify(request) + '\n');
    });

    const timer = setTimeout(
      () => finish(new Error(`Timed out after ${BROKER_REQUEST_TIMEOUT_MS / 1000}s waiting for the broker.`)),
      BROKER_REQUEST_TIMEOUT_MS
    );

    let buffer = '';
    socket.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      // The final element is either empty or a partial line; keep it buffered.
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const response = JSON.parse(line);
          if (response.error) finish(new Error(response.error.message));
          else finish(null, response.result);
          return;
        } catch {
          // Not valid JSON: skip this line and keep reading.
        }
      }
    });

    socket.on('close', () => {
      finish(new Error('Broker closed the connection before responding.'));
    });

    socket.on('error', (err) => {
      finish(new Error(`Cannot connect to broker. Is it running?\n  Start it with: claude-muse talk broker\n  Error: ${err.message}`));
    });
  });
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
    .description('Setup Meta Model API credentials')
    .action(setupCommand);

  program
    .command('models')
    .description('List available models')
    .option('--select', 'Select a model interactively')
    .action(modelsCommand);

  program
    .command('doctor')
    .description('Check system configuration and API connectivity')
    .action(doctorCommand);

  program
    .command('launch')
    .description('Launch Claude Code with Muse Spark (default)')
    .option('--model <id>', 'Specify model to use')
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
    .option('--harness <harness>', "Which CLI you are joining from: 'claude' or 'muse'", 'claude')
    .description('Join a talk room')
    .action(async (room: string, name: string, options: { harness: string }) => {
      try {
        if (options.harness !== 'claude' && options.harness !== 'muse') {
          console.error(`Unknown harness '${options.harness}'. Expected 'claude' or 'muse'.`);
          process.exit(1);
        }
        const result = await brokerRequest('join', { room, name, harness: options.harness });
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
