const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const app = express();

const port = Number(process.env.PORT || 3001);
const corsOrigin = process.env.CORS_ORIGIN || '*';
const maxPayloadMb = Number(process.env.MASK_MAX_PAYLOAD_MB || 500);
const timeoutMs = Number(process.env.MASK_EXEC_TIMEOUT_MS || 120000);
const maxBufferMb = Number(process.env.MASK_EXEC_MAX_BUFFER_MB || 20);
const outputExt = process.env.MASK_OUTPUT_EXT || '.ply';
const keepTemp = String(process.env.MASK_KEEP_TEMP || 'false').toLowerCase() === 'true';

const tempDir = path.join(__dirname, 'tmp');
fs.mkdirSync(tempDir, { recursive: true });

app.use(cors({ origin: corsOrigin }));
app.use(express.raw({ type: 'application/octet-stream', limit: `${maxPayloadMb}mb` }));

const nowId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const buildCommand = (inputPath, outputPath) => {
  const cmdTemplate = process.env.MASK_CLI_CMD;
  if (!cmdTemplate || !cmdTemplate.trim()) {
    return null;
  }

  if (cmdTemplate.includes('{input}') || cmdTemplate.includes('{output}')) {
    return cmdTemplate
      .replaceAll('{input}', `"${inputPath}"`)
      .replaceAll('{output}', `"${outputPath}"`);
  }

  return `${cmdTemplate} "${inputPath}" "${outputPath}"`;
};

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'mask-bridge',
    port,
    tempDir
  });
});

app.post('/process-mask', async (req, res) => {
  if (!req.body || !Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({
      ok: false,
      error: 'Empty payload. Send application/octet-stream with .ply bytes.'
    });
  }

  const id = nowId();
  const inputPath = path.join(tempDir, `mask-in-${id}.ply`);
  const outputPath = path.join(tempDir, `mask-out-${id}${outputExt}`);

  try {
    fs.writeFileSync(inputPath, req.body);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: 'Failed to write temporary input file.',
      details: err.message
    });
  }

  const command = buildCommand(inputPath, outputPath);
  if (!command) {
    return res.status(501).json({
      ok: false,
      error: 'MASK_CLI_CMD is not configured.',
      hint: 'Set MASK_CLI_CMD using placeholders {input} and {output}.',
      example: 'MASK_CLI_CMD=splat-transform {input} {output} -w',
      inputPath,
      outputPath
    });
  }

  const start = Date.now();

  exec(
    command,
    {
      cwd: process.env.MASK_CLI_CWD || __dirname,
      timeout: timeoutMs,
      maxBuffer: maxBufferMb * 1024 * 1024
    },
    (err, stdout, stderr) => {
      const elapsedMs = Date.now() - start;
      const outputExists = fs.existsSync(outputPath);

      if (err) {
        return res.status(500).json({
          ok: false,
          error: 'CLI command failed.',
          command,
          elapsedMs,
          outputExists,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
          details: err.message,
          inputPath,
          outputPath
        });
      }

      if (!outputExists) {
        return res.status(500).json({
          ok: false,
          error: 'CLI finished but output file was not created.',
          command,
          elapsedMs,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
          inputPath,
          outputPath
        });
      }

      const outputStats = fs.statSync(outputPath);

      if (!keepTemp) {
        try {
          fs.unlinkSync(inputPath);
        } catch (_ignored) {
        }
      }

      return res.status(200).json({
        ok: true,
        elapsedMs,
        outputPath,
        outputBytes: outputStats.size,
        stdout: String(stdout || ''),
        stderr: String(stderr || '')
      });
    }
  );
});

app.listen(port, () => {
  console.log(`[bridge] running on http://localhost:${port}`);
  console.log(`[bridge] temp dir: ${tempDir}`);
  if (!process.env.MASK_CLI_CMD) {
    console.log('[bridge] MASK_CLI_CMD is not set. /process-mask will return 501 until configured.');
  }
});
