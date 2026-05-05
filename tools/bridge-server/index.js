const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// Carrega variaveis de ambiente do arquivo local .env quando disponivel.
if (typeof process.loadEnvFile === 'function') {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const app = express();

const port = Number(process.env.PORT || 3001);
const corsOrigin = process.env.CORS_ORIGIN || '*';
const maxPayloadMb = Number(process.env.MASK_MAX_PAYLOAD_MB || 500);
const timeoutMs = Number(process.env.MASK_EXEC_TIMEOUT_MS || 120000);
const maxBufferMb = Number(process.env.MASK_EXEC_MAX_BUFFER_MB || 20);
const outputExt = process.env.MASK_OUTPUT_EXT || '.ply';
const outputSuffix = process.env.MASK_OUTPUT_SUFFIX || '_output';
const keepTemp = String(process.env.MASK_KEEP_TEMP || 'false').toLowerCase() === 'true';

const tempDir = path.join(__dirname, 'tmp');
fs.mkdirSync(tempDir, { recursive: true });

app.use(cors({ origin: corsOrigin }));
app.use(express.raw({ type: 'application/octet-stream', limit: `${maxPayloadMb}mb` }));

const nowId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const quote = (p) => `"${p}"`;

const hasOverwriteFlag = (cmdTemplate) => /(^|\s)(-w|--overwrite)(\s|$)/.test(cmdTemplate);

const buildCommandFromTemplate = (cmdTemplate, values, appendArgs) => {
  const placeholders = [...cmdTemplate.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]);
  for (const key of placeholders) {
    if (!(key in values)) {
      return {
        ok: false,
        error: `Unknown placeholder {${key}} in command template.`
      };
    }
  }

  let command = cmdTemplate;
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string') {
      command = command.replaceAll(`{${key}}`, quote(value));
    }
  }

  if (placeholders.length === 0 && Array.isArray(appendArgs) && appendArgs.length > 0) {
    command = `${command} ${appendArgs.map((v) => quote(v)).join(' ')}`;
  }

  return { ok: true, command };
};

const buildPipelineStepValues = (baseValues, stepInput, stepOutput) => {
  return {
    ...baseValues,
    input: stepInput,
    output: stepOutput
  };
};

const execCommand = (command) => new Promise((resolve, reject) => {
  exec(
    command,
    {
      cwd: process.env.MASK_CLI_CWD || __dirname,
      timeout: timeoutMs,
      maxBuffer: maxBufferMb * 1024 * 1024
    },
    (err, stdout, stderr) => {
      if (err) {
        reject({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
        return;
      }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    }
  );
});

const toBaseName = (filename, fallback) => {
  const inputName = (filename || '').trim();
  const safe = path.basename(inputName || fallback).replace(/[\\/:*?"<>|]/g, '_');
  const parsed = path.parse(safe);
  return parsed.name || 'mask';
};

const readHeaderCommand = (req, headerName) => {
  const value = String(req.header(headerName) || '').trim();
  return value;
};

const getPipelineMode = (req) => {
  const selectOverride = req ? readHeaderCommand(req, 'x-select-cli-cmd') : '';
  const maskOverride = req ? readHeaderCommand(req, 'x-mask-cli-cmd') : '';
  const exportOverride = req ? readHeaderCommand(req, 'x-export-cli-cmd') : '';

  const select = selectOverride || (process.env.SELECT_CLI_CMD || '').trim();
  const mask = maskOverride || (process.env.MASK_CLI_CMD || '').trim();
  const exportCmd = exportOverride || (process.env.EXPORT_CLI_CMD || '').trim();

  if (!select && !exportCmd) {
    return {
      type: 'legacy',
      commands: { mask },
      source: {
        select: selectOverride ? 'header' : 'env',
        mask: maskOverride ? 'header' : 'env',
        exportCmd: exportOverride ? 'header' : 'env'
      }
    };
  }

  return {
    type: 'pipeline',
    commands: { select, mask, exportCmd },
    source: {
      select: selectOverride ? 'header' : 'env',
      mask: maskOverride ? 'header' : 'env',
      exportCmd: exportOverride ? 'header' : 'env'
    }
  };
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
  const selectedPath = path.join(tempDir, `mask-selected-${id}.ply`);
  const maskedPath = path.join(tempDir, `mask-masked-${id}.ply`);
  const requestedFileName = String(req.header('x-input-filename') || '').trim();
  const baseName = toBaseName(requestedFileName, path.basename(inputPath));
  const outputPath = path.join(tempDir, `${baseName}${outputSuffix}${outputExt}`);

  try {
    fs.writeFileSync(inputPath, req.body);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: 'Failed to write temporary input file.',
      details: err.message
    });
  }

  const start = Date.now();

  const mode = getPipelineMode(req);
  const templateValues = {
    input: inputPath,
    selected: selectedPath,
    masked: maskedPath,
    output: outputPath
  };

  const steps = [];

  if (mode.type === 'legacy') {
    if (!mode.commands.mask) {
      return res.status(501).json({
        ok: false,
        error: 'No CLI command configured.',
        hint: 'Set MASK_CLI_CMD (legacy) or SELECT_CLI_CMD + MASK_CLI_CMD + EXPORT_CLI_CMD (pipeline).',
        inputPath,
        outputPath
      });
    }

    if (!hasOverwriteFlag(mode.commands.mask)) {
      return res.status(400).json({
        ok: false,
        error: 'MASK_CLI_CMD must include -w or --overwrite.'
      });
    }

    const built = buildCommandFromTemplate(mode.commands.mask, templateValues, [inputPath, outputPath]);
    if (!built.ok) {
      return res.status(400).json({ ok: false, error: built.error });
    }
    steps.push({ name: 'mask', command: built.command, expectedOutput: outputPath });
  } else {
    if (!mode.commands.select || !mode.commands.mask || !mode.commands.exportCmd) {
      return res.status(501).json({
        ok: false,
        error: 'Pipeline mode requires SELECT_CLI_CMD, MASK_CLI_CMD and EXPORT_CLI_CMD.',
        configured: {
          SELECT_CLI_CMD: Boolean(mode.commands.select),
          MASK_CLI_CMD: Boolean(mode.commands.mask),
          EXPORT_CLI_CMD: Boolean(mode.commands.exportCmd)
        }
      });
    }

    const templates = [
      { name: 'select', template: mode.commands.select, expectedOutput: selectedPath, stepInput: inputPath },
      { name: 'mask', template: mode.commands.mask, expectedOutput: maskedPath, stepInput: selectedPath },
      { name: 'export', template: mode.commands.exportCmd, expectedOutput: outputPath, stepInput: maskedPath }
    ];

    for (const { name, template, expectedOutput, stepInput } of templates) {
      if (!hasOverwriteFlag(template)) {
        return res.status(400).json({
          ok: false,
          error: `${name.toUpperCase()}_CLI_CMD must include -w or --overwrite.`
        });
      }
      const stepValues = buildPipelineStepValues(templateValues, stepInput, expectedOutput);
      const built = buildCommandFromTemplate(template, stepValues);
      if (!built.ok) {
        return res.status(400).json({ ok: false, error: built.error });
      }
      steps.push({ name, command: built.command, expectedOutput });
    }
  }

  const stepResults = [];

  try {
    for (const step of steps) {
      const result = await execCommand(step.command);
      stepResults.push({
        name: step.name,
        command: step.command,
        stdout: result.stdout,
        stderr: result.stderr,
        outputPath: step.expectedOutput
      });

      if (!fs.existsSync(step.expectedOutput)) {
        return res.status(500).json({
          ok: false,
          error: `CLI step '${step.name}' finished but output was not created.`,
          elapsedMs: Date.now() - start,
          step: step.name,
          command: step.command,
          outputPath: step.expectedOutput,
          steps: stepResults
        });
      }
    }
  } catch (failure) {
    return res.status(500).json({
      ok: false,
      error: 'CLI command failed.',
      elapsedMs: Date.now() - start,
      details: failure.err?.message || 'unknown error',
      stdout: failure.stdout,
      stderr: failure.stderr,
      steps: stepResults,
      inputPath,
      outputPath
    });
  }

  const elapsedMs = Date.now() - start;
  const outputStats = fs.statSync(outputPath);

  if (!keepTemp) {
    for (const p of [inputPath, selectedPath, maskedPath]) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch (_ignored) {
      }
    }
  }

  return res.status(200).json({
    ok: true,
    elapsedMs,
    outputPath,
    outputBytes: outputStats.size,
    steps: stepResults
  });
});

app.listen(port, () => {
  console.log(`[bridge] running on http://localhost:${port}`);
  console.log(`[bridge] temp dir: ${tempDir}`);
  const mode = getPipelineMode();
  if (mode.type === 'legacy') {
    if (!process.env.MASK_CLI_CMD) {
      console.log('[bridge] MASK_CLI_CMD is not set. /process-mask will return 501 until configured.');
    } else {
      console.log('[bridge] running in legacy single-step mode (MASK_CLI_CMD).');
    }
  } else {
    console.log('[bridge] running in pipeline mode (SELECT_CLI_CMD -> MASK_CLI_CMD -> EXPORT_CLI_CMD).');
  }
});
