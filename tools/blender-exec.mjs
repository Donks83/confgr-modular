#!/usr/bin/env node
// Run Python inside the Blender that is open on this machine, and print its answer.
//
//   node tools/blender-exec.mjs "import bpy; result['objects'] = len(bpy.data.objects)"
//   node tools/blender-exec.mjs --file script.py
//
// Talks to Blender Lab's own "MCP" extension (Preferences > Add-ons > MCP, port
// 9876), which is NOT the community blender-mcp add-on the handover assumed. Its
// protocol is one JSON object terminated by a NULL BYTE:
//
//   {"type": "execute", "code": "<python>", "strict_json": true}\0
//
// and the reply is JSON, also NULL-terminated. The code fills a dict called
// `result`. Sending {"type": ..., "params": ...} without the terminator is what
// produced "Client timed out" for a whole session: the server was waiting for
// the end of a request that never came, not busy.
//
// Model work through here is for inspection and comparison renders. Anything that
// changes a model belongs in a pipeline script that reruns from the STEP source.

import net from 'node:net';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const code = args[0] === '--file' ? readFileSync(args[1], 'utf8') : args.join(' ');
if (!code) {
  console.error('usage: node tools/blender-exec.mjs "<python>" | --file script.py');
  process.exit(2);
}
const port = Number(process.env.BLENDER_MCP_PORT || 9876);
const socket = net.createConnection(port, '127.0.0.1');
let buf = Buffer.alloc(0);

socket.on('connect', () => socket.write(`${JSON.stringify({ type: 'execute', code, strict_json: true })}\0`));
socket.on('data', (d) => {
  buf = Buffer.concat([buf, d]);
  const end = buf.indexOf(0);
  if (end < 0) return;
  const reply = JSON.parse(buf.subarray(0, end).toString('utf8'));
  console.log(JSON.stringify(reply, null, 1));
  socket.end();
  process.exitCode = reply.status === 'ok' ? 0 : 1;
});
socket.setTimeout(Number(process.env.BLENDER_MCP_TIMEOUT_MS || 60000), () => {
  console.error('Blender did not answer. Is the MCP add-on running (Preferences > Add-ons > MCP)?');
  socket.destroy();
  process.exitCode = 1;
});
socket.on('error', (e) => {
  console.error(`Cannot reach Blender on ${port}: ${e.message}`);
  process.exitCode = 1;
});
