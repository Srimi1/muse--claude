#!/usr/bin/env node
import { Command } from 'commander';
import { setupCommand } from './commands/setup.js';
import { modelsCommand } from './commands/models.js';
import { doctorCommand } from './commands/doctor.js';
import { launchCommand } from './commands/launch.js';
import { startBroker } from './broker/server.js';
import net from 'net';
import { SOCKET_PATH } from './config/constants.js';

/**
 * Sends a JSON-RPC request to the broker and returns the result.
 */
async function brokerRequest(method: string, params: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(SOCKET_PATH, () => {
      const request = { jsonrpc: '2.0', id: 1, method, params };
      socket.write(JSON.stringify(request) + '\n');
    });

    let buffer = '';
    socket.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const response = JSON.parse(line);
          socket.destroy();
          if (response.error) {
            reject(new Error(response.error.message));
          } else {
            resolve(response.result);
          }
        } catch { /* wait for more data */ }
      }
    });

    socket.on('error', (err) => {
      reject(new Error(`Cannot connect to broker. Is it running?\n  Start it with: claude-muse talk broker\n  Error: ${err.message}`));
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
    .description('Join a talk room')
    .action(async (room: string, name: string) => {
      try {
        const result = await brokerRequest('join', { room, name, harness: 'claude' });
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
        console.log(`Messages: ${r.messageCount}/${6}`);
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

  // Default to launch if no subcommand
  const args = process.argv.slice(2);
  const subcommands = ['setup', 'models', 'doctor', 'launch', 'talk', 'help'];
  const hasSubcommand = args.length > 0 && !args[0].startsWith('-') && subcommands.includes(args[0]);

  if (!hasSubcommand && !args.includes('--help') && !args.includes('-h') && !args.includes('--version') && !args.includes('-V')) {
    process.argv.splice(2, 0, 'launch');
  }

  program.parse(process.argv);
}

// Run CLI
runCli();
